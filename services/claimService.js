const { Claim, Policy, Worker, MonitoringData } = require('../models');
const fraudDetectionService = require('./fraudDetectionService');
const payoutService = require('./payoutService');
const recommendationService = require('./recommendationService');
const { v4: uuidv4 } = require('uuid');

class ClaimService {
  // Create automated claim from monitoring trigger
  async createAutomatedClaim(policyId, triggerData) {
    try {
      const policy = await Policy.findById(policyId).populate('workerId');
      if (!policy) {
        throw new Error('Policy not found');
      }

      if (policy.status.current !== 'active') {
        console.log(`Policy ${policyId} is not active, skipping claim creation`);
        return null;
      }

      const worker = policy.workerId;
      const hasActivePremium = Boolean(worker?.premium?.currentWeekPaid) && worker?.status?.subscriptionStatus === 'active';
      if (!hasActivePremium) {
        console.log(`Worker ${worker?._id} has no active weekly premium, skipping automated payout claim`);
        return null;
      }

      // Check if there's already a recent claim for the same trigger
      const recentClaim = await Claim.findOne({
        policyId,
        'trigger.type': triggerData.type,
        'trigger.timestamp': {
          $gte: new Date(Date.now() - 2 * 60 * 60 * 1000) // Last 2 hours
        },
        'status.current': { $in: ['initiated', 'validating', 'approved'] }
      });

      if (recentClaim) {
        console.log(`Recent claim already exists for policy ${policyId}, skipping`);
        return recentClaim;
      }

      // Get validation data from multiple sources
      const validationData = await this.getValidationData(triggerData);
      
      // Calculate financial loss
      const financialLoss = await this.calculateFinancialLoss(policy, triggerData);

      // Create claim
      const claim = new Claim({
        policyId,
        workerId: policy.workerId._id,
        trigger: {
          type: triggerData.type,
          timestamp: new Date(),
          location: triggerData.location,
          detectedValues: triggerData.detectedValues,
          thresholds: triggerData.thresholds
        },
        validation: validationData,
        financial: financialLoss,
        status: {
          current: 'initiated',
          initiatedAt: new Date()
        },
        fraud: {
          riskScore: 0,
          flags: [],
          manualReviewRequired: false
        },
        audit: {
          source: triggerData.simulationMode ? 'simulation' : 'automated',
          decisionLogic: {
            triggeredBy: 'parametric_threshold',
            confidenceLevel: validationData.consensusScore || 0.8,
            automatedDecision: 'initiated'
          }
        }
      });

      // Log claim submission event to timeline
      recommendationService.logTimelineEvent(claim, 'claim_submitted', 'success', {
        triggerType: triggerData.type,
        location: triggerData.location,
        timestamp: new Date()
      });

      await claim.save();

      // Start validation process
      await this.validateClaim(claim._id);

      return claim;
    } catch (error) {
      console.error('Error creating automated claim:', error);
      return null;
    }
  }

  // Get validation data from multiple sources
  async getValidationData(triggerData) {
    try {
      if (triggerData.simulationMode) {
        const simulationSnapshot = triggerData.type === 'extreme_weather'
          ? triggerData.detectedValues?.weather
          : triggerData.type === 'high_pollution'
            ? triggerData.detectedValues?.pollution
            : triggerData.detectedValues?.traffic;

        return {
          apiSources: simulationSnapshot ? [{
            name: 'simulation_event',
            data: simulationSnapshot,
            timestamp: new Date(),
            matchesTrigger: true,
            confidence: 1
          }] : [],
          consensusScore: simulationSnapshot ? 1 : 0,
          gpsValidation: {
            isLocationValid: true,
            distanceFromTrigger: 0
          },
          activityValidation: {
            isActivityConsistent: true
          }
        };
      }

      const validationData = {
        apiSources: [],
        consensusScore: 0,
        gpsValidation: {
          isLocationValid: true,
          distanceFromTrigger: 0
        },
        activityValidation: {
          isActivityConsistent: true
        }
      };

      // Get data from multiple APIs for consensus
      const { latitude, longitude } = triggerData.location;
      
      // Weather validation
      if (triggerData.type === 'extreme_weather') {
        const weatherData = await MonitoringData.findLatestForLocation('weather', triggerData.location, 60);
        if (weatherData && weatherData.length > 0) {
          validationData.apiSources.push({
            name: 'openweather',
            data: weatherData[0].data.weather,
            timestamp: weatherData[0].metadata.timestamp,
            matchesTrigger: this.checkWeatherMatch(triggerData.detectedValues.weather, weatherData[0].data.weather, triggerData.thresholds.weather),
            confidence: 0.9
          });
        }
      }

      // Pollution validation
      if (triggerData.type === 'high_pollution') {
        const pollutionData = await MonitoringData.findLatestForLocation('pollution', triggerData.location, 60);
        if (pollutionData && pollutionData.length > 0) {
          validationData.apiSources.push({
            name: 'openaq',
            data: pollutionData[0].data.pollution,
            timestamp: pollutionData[0].metadata.timestamp,
            matchesTrigger: this.checkPollutionMatch(triggerData.detectedValues.pollution, pollutionData[0].data.pollution, triggerData.thresholds.pollution),
            confidence: 0.8
          });
        }
      }

      // Traffic validation
      if (triggerData.type === 'traffic_congestion') {
        const trafficData = await MonitoringData.findLatestForLocation('traffic', triggerData.location, 30);
        if (trafficData && trafficData.length > 0) {
          validationData.apiSources.push({
            name: 'google',
            data: trafficData[0].data.traffic,
            timestamp: trafficData[0].metadata.timestamp,
            matchesTrigger: this.checkTrafficMatch(triggerData.detectedValues.traffic, trafficData[0].data.traffic, triggerData.thresholds.traffic),
            confidence: 0.85
          });
        }
      }

      // Calculate consensus score
      if (validationData.apiSources.length > 0) {
        const matchingSources = validationData.apiSources.filter(source => source.matchesTrigger);
        validationData.consensusScore = matchingSources.length / validationData.apiSources.length;
      } else if (triggerData.type === 'extreme_weather' && triggerData.detectedValues?.weather) {
        validationData.apiSources.push({
          name: 'live_monitoring_event',
          data: triggerData.detectedValues.weather,
          timestamp: new Date(),
          matchesTrigger: true,
          confidence: 0.85
        });
        validationData.consensusScore = 1;
      }

      return validationData;
    } catch (error) {
      console.error('Error getting validation data:', error);
      return {
        apiSources: [],
        consensusScore: 0,
        gpsValidation: { isLocationValid: true, distanceFromTrigger: 0 },
        activityValidation: { isActivityConsistent: true }
      };
    }
  }

  // Check weather data match
  checkWeatherMatch(detectedValues, apiData, thresholds) {
    try {
      if (detectedValues.rainfall > thresholds.rainfall && apiData.rainfall > thresholds.rainfall * 0.8) {
        return true;
      }
      if (detectedValues.windSpeed > thresholds.windSpeed && apiData.windSpeed > thresholds.windSpeed * 0.8) {
        return true;
      }
      if (detectedValues.temperature > thresholds.temperature && apiData.temperature > thresholds.temperature * 0.9) {
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error checking weather match:', error);
      return false;
    }
  }

  // Check pollution data match
  checkPollutionMatch(detectedValues, apiData, thresholds) {
    try {
      if (detectedValues.aqi > thresholds.aqi && apiData.aqi > thresholds.aqi * 0.9) {
        return true;
      }
      if (detectedValues.pm25 > thresholds.pm25 && apiData.pm25 > thresholds.pm25 * 0.9) {
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error checking pollution match:', error);
      return false;
    }
  }

  // Check traffic data match
  checkTrafficMatch(detectedValues, apiData, thresholds) {
    try {
      if (detectedValues.congestionLevel > thresholds.congestionLevel && apiData.congestionLevel > thresholds.congestionLevel * 0.8) {
        return true;
      }
      if (detectedValues.averageSpeed < thresholds.averageSpeed && apiData.averageSpeed < thresholds.averageSpeed * 1.2) {
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error checking traffic match:', error);
      return false;
    }
  }

  // Calculate financial loss
  async calculateFinancialLoss(policy, triggerData) {
    try {
      const worker = await Worker.findById(policy.workerId._id);
      const hourlyRate = worker.financialInfo.weeklyIncomeRange.max / (5 * 8); // Assume 5 days, 8 hours per week
      
      // Estimate working hours lost based on trigger severity
      let hoursLost = 2; // Default 2 hours
      
      if (triggerData.type === 'extreme_weather') {
        const weather = triggerData.detectedValues.weather;
        if (weather.rainfall > 50) hoursLost = 8; // Heavy rain
        else if (weather.rainfall > 25) hoursLost = 4; // Moderate rain
        else if (weather.windSpeed > 60) hoursLost = 6; // High wind
      } else if (triggerData.type === 'high_pollution') {
        const pollution = triggerData.detectedValues.pollution;
        if (pollution.aqi > 500) hoursLost = 8; // Hazardous
        else if (pollution.aqi > 400) hoursLost = 4; // Very unhealthy
        else if (pollution.aqi > 300) hoursLost = 2; // Unhealthy
      } else if (triggerData.type === 'traffic_congestion') {
        const traffic = triggerData.detectedValues.traffic;
        if (traffic.congestionLevel > 9) hoursLost = 4; // Extreme congestion
        else if (traffic.congestionLevel > 7) hoursLost = 2; // Heavy congestion
      }

      const totalLoss = hoursLost * hourlyRate;
      
      // Apply policy limits
      const remainingWeeklyLimit = Math.max(
        0,
        (policy.coverage.maxPayoutPerWeek || 0) - (policy.claims?.totalPayoutAmount || 0)
      );
      const payoutAmount = Math.max(0, Math.min(
        totalLoss,
        policy.coverage.maxPayoutPerClaim,
        remainingWeeklyLimit
      ));

      return {
        estimatedLoss: {
          workingHoursLost: hoursLost,
          hourlyRate: Math.round(hourlyRate),
          totalLoss: Math.round(totalLoss)
        },
        payoutAmount: Math.round(payoutAmount),
        payoutCurrency: 'INR',
        payoutMethod: 'upi',
        payoutStatus: 'pending'
      };
    } catch (error) {
      console.error('Error calculating financial loss:', error);
      return {
        estimatedLoss: {
          workingHoursLost: 2,
          hourlyRate: 100,
          totalLoss: 200
        },
        payoutAmount: 200,
        payoutCurrency: 'INR',
        payoutMethod: 'upi',
        payoutStatus: 'pending'
      };
    }
  }

  // Validate claim
  async validateClaim(claimId) {
    try {
      const claim = await Claim.findById(claimId).populate('policyId').populate('workerId');
      if (!claim) {
        throw new Error('Claim not found');
      }

      const policy = claim.policyId;
      const worker = claim.workerId;

      // Update status to validating
      claim.status.current = 'validating';
      claim.status.validatedAt = new Date();

      // Log verification step based on trigger type
      const triggerType = claim.trigger?.type;
      let envStatus = 'success';
      let consensus = claim.validation?.consensusScore !== undefined ? claim.validation.consensusScore : 1.0;
      if (consensus < 0.6) {
        envStatus = 'warning';
      }

      if (triggerType === 'extreme_weather') {
        recommendationService.logTimelineEvent(claim, 'weather_verification', envStatus, {
          detected: claim.trigger.detectedValues?.weather,
          thresholds: claim.trigger.thresholds?.weather,
          consensusScore: consensus
        });
      } else if (triggerType === 'traffic_congestion') {
        recommendationService.logTimelineEvent(claim, 'traffic_verification', envStatus, {
          detected: claim.trigger.detectedValues?.traffic,
          thresholds: claim.trigger.thresholds?.traffic,
          consensusScore: consensus
        });
      } else if (triggerType === 'high_pollution') {
        recommendationService.logTimelineEvent(claim, 'pollution_verification', envStatus, {
          detected: claim.trigger.detectedValues?.pollution,
          thresholds: claim.trigger.thresholds?.pollution,
          consensusScore: consensus
        });
      }

      if (claim.audit?.source === 'simulation') {
        claim.fraud.riskScore = 0.1;
        claim.fraud.flags = [];
        claim.fraud.manualReviewRequired = false;
      } else {
        // Run fraud detection
        const fraudResult = await fraudDetectionService.analyzeClaim(claim);
        claim.fraud.riskScore = fraudResult.riskScore;
        claim.fraud.flags = fraudResult.flags;
        claim.fraud.manualReviewRequired = fraudResult.manualReviewRequired;
      }

      // Log fraud check completion
      const fraudStatus = claim.fraud.riskScore >= 0.7 ? 'failed' : claim.fraud.riskScore >= 0.4 ? 'warning' : 'success';
      recommendationService.logTimelineEvent(claim, 'fraud_detected', fraudStatus, {
        riskScore: claim.fraud.riskScore,
        flagsCount: claim.fraud.flags?.length || 0
      });

      // Run Explainable Claim Decision Engine (ECDE)
      const ecdeResult = await recommendationService.evaluateClaim(claim, policy, worker);
      claim.ecdeDetails = ecdeResult;

      // Log reliability score calculation
      const reliabilityStatus = ecdeResult.reliabilityScore >= 70 ? 'success' : ecdeResult.reliabilityScore >= 40 ? 'warning' : 'failed';
      recommendationService.logTimelineEvent(claim, 'reliability_calculated', reliabilityStatus, {
        reliabilityScore: ecdeResult.reliabilityScore,
        confidenceScore: ecdeResult.confidenceScore,
        factors: ecdeResult.whyThisRecommendation
      });

      // Log ECDE recommendation generation
      recommendationService.logTimelineEvent(claim, 'ecde_recommendation_generated', 'success', {
        decision: ecdeResult.decision,
        suggestedCompensation: ecdeResult.suggestedCompensation,
        explanations: ecdeResult.explanation
      });

      // Apply decision to claim status (gated under review for final human approval)
      if (ecdeResult.decision === 'recommended_approval' || ecdeResult.decision === 'manual_review') {
        claim.status.current = 'under_review';
        claim.fraud.manualReviewRequired = true;
        claim.audit.decisionLogic.automatedDecision = ecdeResult.decision;

        // Increment Policy pending counter
        await Policy.findByIdAndUpdate(policy._id, {
          $inc: {
            'claims.totalClaims': 1,
            'claims.pendingClaims': 1
          }
        });

        recommendationService.logTimelineEvent(claim, 'admin_review_started', 'pending', {
          reviewerRole: 'Admin'
        });

      } else {
        // Recommended rejection
        claim.status.current = 'rejected';
        claim.status.rejectedAt = new Date();
        claim.audit.decisionLogic.automatedDecision = 'recommended_rejection';

        // Increment Policy rejected counter
        await Policy.findByIdAndUpdate(policy._id, {
          $inc: {
            'claims.totalClaims': 1,
            'claims.rejectedClaims': 1
          }
        });

        // Also increment worker's rejected claims counter
        await Worker.findByIdAndUpdate(worker._id, {
          $inc: {
            'riskProfile.historicalClaims.totalClaims': 1,
            'riskProfile.historicalClaims.rejectedClaims': 1
          }
        });

        recommendationService.logTimelineEvent(claim, 'admin_decision_completed', 'success', {
          decision: 'rejected',
          notes: 'Automated parametric rejection recommended by ECDE due to high risk or lack of trigger match.'
        });
      }

      claim.metadata.updatedAt = new Date();
      await claim.save();

      return claim;
    } catch (error) {
      console.error('Error validating claim:', error);
      throw error;
    }
  }

  // Process payout
  async processPayout(claimId) {
    try {
      const claim = await Claim.findById(claimId).populate('workerId');
      if (!claim) {
        throw new Error('Claim not found');
      }

      // Ensure payout amount is set from suggested compensation
      const amount = claim.ecdeDetails?.suggestedCompensation !== undefined
        ? claim.ecdeDetails.suggestedCompensation
        : claim.financial.payoutAmount;
      
      claim.financial.payoutAmount = amount;

      // Process UPI payout
      const payoutResult = await payoutService.processUPIPayout({
        upiId: claim.workerId.financialInfo.upiId,
        amount: claim.financial.payoutAmount,
        claimId: claim.claimNumber,
        description: `FixMyPay ECDE Parametric Payout - ${claim.trigger.type}`
      });

      if (payoutResult.success) {
        claim.financial.payoutStatus = 'completed';
        claim.financial.payoutTransactionId = payoutResult.transactionId;
        claim.financial.payoutProcessedAt = new Date();
        claim.status.current = 'paid';
        claim.status.paidAt = new Date();

        recommendationService.logTimelineEvent(claim, 'payout_released', 'success', {
          transactionId: payoutResult.transactionId,
          amount: claim.financial.payoutAmount,
          method: 'upi'
        });
      } else {
        claim.financial.payoutStatus = 'failed';
        claim.financial.payoutFailureReason = payoutResult.error;

        recommendationService.logTimelineEvent(claim, 'payout_released', 'failed', {
          error: payoutResult.error
        });
      }

      await claim.save();
      return payoutResult;
    } catch (error) {
      console.error('Error processing payout:', error);
      throw error;
    }
  }

  // Get claim by ID
  async getClaimById(claimId, workerId = null) {
    try {
      const query = { _id: claimId };
      if (workerId) {
        query.workerId = workerId;
      }

      const claim = await Claim.findOne(query)
        .populate('policyId', 'policyNumber coverage premium')
        .populate('workerId', 'personalInfo.firstName personalInfo.lastName personalInfo.email');

      return claim;
    } catch (error) {
      console.error('Error getting claim by ID:', error);
      throw error;
    }
  }

  // Get worker claims
  async getWorkerClaims(workerId, options = {}) {
    try {
      const { status, limit = 10, page = 1 } = options;
      
      const query = { workerId };
      if (status) {
        query['status.current'] = status;
      }

      const claims = await Claim.find(query)
        .sort({ 'metadata.createdAt': -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit)
        .populate('policyId', 'policyNumber');

      const total = await Claim.countDocuments(query);

      return {
        claims,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      console.error('Error getting worker claims:', error);
      throw error;
    }
  }

  // Manual claim review (admin)
  async reviewClaim(claimId, adminId, decision, notes = '') {
    try {
      const claim = await Claim.findById(claimId);
      if (!claim) {
        throw new Error('Claim not found');
      }

      claim.fraud.reviewedBy = adminId;
      claim.fraud.reviewNotes = notes;
      claim.fraud.reviewDecision = decision;

      recommendationService.logTimelineEvent(claim, 'admin_decision_completed', 'success', {
        decision,
        notes,
        reviewerId: adminId
      });

      if (decision === 'approve') {
        claim.status.current = 'approved';
        claim.status.approvedAt = new Date();
        
        // Payout amount should match suggested compensation if available
        const payoutAmount = claim.ecdeDetails?.suggestedCompensation !== undefined
          ? claim.ecdeDetails.suggestedCompensation
          : claim.financial.payoutAmount;
        claim.financial.payoutAmount = payoutAmount;

        // Update Policy approved stats and decrement pending!
        await Policy.findByIdAndUpdate(claim.policyId, {
          $inc: {
            'claims.approvedClaims': 1,
            'claims.totalPayoutAmount': payoutAmount,
            'claims.pendingClaims': -1
          },
          $set: {
            'claims.lastClaimDate': new Date()
          }
        });

        // Update Worker historical claims stats
        await Worker.findByIdAndUpdate(claim.workerId, {
          $inc: {
            'riskProfile.historicalClaims.totalClaims': 1,
            'riskProfile.historicalClaims.approvedClaims': 1,
            'riskProfile.historicalClaims.totalPayoutAmount': payoutAmount
          }
        });

        await this.processPayout(claimId);
      } else if (decision === 'reject') {
        claim.status.current = 'rejected';
        claim.status.rejectedAt = new Date();

        // Update Policy rejected stats and decrement pending!
        await Policy.findByIdAndUpdate(claim.policyId, {
          $inc: {
            'claims.rejectedClaims': 1,
            'claims.pendingClaims': -1
          }
        });

        // Update Worker historical claims stats
        await Worker.findByIdAndUpdate(claim.workerId, {
          $inc: {
            'riskProfile.historicalClaims.totalClaims': 1,
            'riskProfile.historicalClaims.rejectedClaims': 1
          }
        });
      }

      claim.metadata.updatedAt = new Date();
      await claim.save();

      return claim;
    } catch (error) {
      console.error('Error reviewing claim:', error);
      throw error;
    }
  }

  // Get claims requiring manual review
  async getClaimsForReview(options = {}) {
    try {
      const { limit = 20, page = 1 } = options;
      
      const claims = await Claim.find({
        'fraud.manualReviewRequired': true,
        'status.current': { $in: ['under_review', 'validating'] }
      })
        .sort({ 'metadata.createdAt': -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit)
        .populate('policyId', 'policyNumber')
        .populate('workerId', 'personalInfo.firstName personalInfo.lastName personalInfo.email');

      const total = await Claim.countDocuments({
        'fraud.manualReviewRequired': true,
        'status.current': { $in: ['under_review', 'validating'] }
      });

      return {
        claims,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      console.error('Error getting claims for review:', error);
      throw error;
    }
  }
}

module.exports = new ClaimService();
