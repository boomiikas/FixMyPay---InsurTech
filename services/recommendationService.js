const { Claim, Worker, Policy } = require('../models');

class RecommendationService {
  /**
   * Evaluates a claim, its policy, and worker profile using deterministic business rules
   * to output a decision, reliability score, suggested payout, and panel-friendly explanations.
   * 
   * @param {Object} claim The Claim document
   * @param {Object} policy The Policy document
   * @param {Object} worker The Worker document
   * @returns {Promise<Object>} Refined ECDE metrics and explains
   */
  async evaluateClaim(claim, policy, worker) {
    const startTime = Date.now();
    
    if (!claim || !policy || !worker) {
      throw new Error('Claim, Policy, and Worker objects are required for ECDE evaluation');
    }

    // 1. Coverage details
    const policyActive = policy.status?.current === 'active';
    const premiumPaid = worker.premium?.currentWeekPaid && worker.status?.subscriptionStatus === 'active';
    const coverageActive = policyActive && premiumPaid;

    const fraudScore = claim.fraud?.riskScore || 0;
    
    // Helper to calculate threshold-activated disruption ratio
    const getDisruptionRatio = (val, thresh) => {
      if (val === undefined || !thresh) return 0;
      const ratio = val / thresh;
      return ratio >= 0.70 ? ratio : 0;
    };

    // Helper to calculate speed disruption ratio (speed is inverse)
    const getSpeedDisruptionRatio = (val, thresh) => {
      if (val === undefined || !thresh || val === 0) return 0;
      const ratio = thresh / val;
      return ratio >= 0.70 ? ratio : 0;
    };

    // 2. Environmental Impact Factor calculation
    let environmentalImpactFactor = 0;
    const whyThisRecommendation = {
      weatherVerified: false,
      trafficVerified: false,
      pollutionVerified: false,
      coverageActive: coverageActive,
      fraudRiskLow: fraudScore < 0.3,
      similarClaimsApproved: false
    };

    const explanation = [];

    // Evaluate active parameter trigger values relative to policy thresholds
    if (claim.trigger?.type === 'extreme_weather') {
      const weather = claim.trigger.detectedValues?.weather;
      const thresholds = claim.trigger.thresholds?.weather;
      
      if (weather && thresholds) {
        let maxWeatherRatio = 0;
        const weatherDetails = [];
        
        if (weather.rainfall !== undefined && thresholds.rainfall) {
          const ratio = getDisruptionRatio(weather.rainfall, thresholds.rainfall);
          maxWeatherRatio = Math.max(maxWeatherRatio, ratio);
          weatherDetails.push(`rainfall: ${weather.rainfall}mm/hr vs ${thresholds.rainfall}mm/hr threshold`);
          if (weather.rainfall >= thresholds.rainfall) whyThisRecommendation.weatherVerified = true;
        }
        if (weather.windSpeed !== undefined && thresholds.windSpeed) {
          const ratio = getDisruptionRatio(weather.windSpeed, thresholds.windSpeed);
          maxWeatherRatio = Math.max(maxWeatherRatio, ratio);
          weatherDetails.push(`wind: ${weather.windSpeed}km/hr vs ${thresholds.windSpeed}km/hr threshold`);
          if (weather.windSpeed >= thresholds.windSpeed) whyThisRecommendation.weatherVerified = true;
        }
        if (weather.temperature !== undefined && thresholds.temperature) {
          const ratio = getDisruptionRatio(weather.temperature, thresholds.temperature);
          maxWeatherRatio = Math.max(maxWeatherRatio, ratio);
          weatherDetails.push(`temperature: ${weather.temperature}°C vs ${thresholds.temperature}°C threshold`);
          if (weather.temperature >= thresholds.temperature) whyThisRecommendation.weatherVerified = true;
        }
        
        environmentalImpactFactor = Math.min(1.0, maxWeatherRatio);
        explanation.push(`Weather verification ratio: ${environmentalImpactFactor.toFixed(2)} (${weatherDetails.join(', ')})`);
      } else {
        explanation.push('Missing weather parameters for environmental impact assessment.');
      }
    } else if (claim.trigger?.type === 'traffic_congestion') {
      const traffic = claim.trigger.detectedValues?.traffic;
      const thresholds = claim.trigger.thresholds?.traffic;
      
      if (traffic && thresholds) {
        let trafficRatio = 0;
        const trafficDetails = [];
        
        if (traffic.congestionLevel !== undefined && thresholds.congestionLevel) {
          const ratio = getDisruptionRatio(traffic.congestionLevel, thresholds.congestionLevel);
          trafficRatio = Math.max(trafficRatio, ratio);
          trafficDetails.push(`congestion: ${traffic.congestionLevel}/10 vs ${thresholds.congestionLevel}/10 threshold`);
          if (traffic.congestionLevel >= thresholds.congestionLevel) whyThisRecommendation.trafficVerified = true;
        }
        if (traffic.averageSpeed !== undefined && thresholds.averageSpeed) {
          const ratio = getSpeedDisruptionRatio(traffic.averageSpeed, thresholds.averageSpeed);
          trafficRatio = Math.max(trafficRatio, ratio);
          trafficDetails.push(`average speed: ${traffic.averageSpeed}km/hr vs ${thresholds.averageSpeed}km/hr threshold`);
          if (traffic.averageSpeed <= thresholds.averageSpeed) whyThisRecommendation.trafficVerified = true;
        }
        
        environmentalImpactFactor = Math.min(1.0, trafficRatio);
        explanation.push(`Traffic verification ratio: ${environmentalImpactFactor.toFixed(2)} (${trafficDetails.join(', ')})`);
      } else {
        explanation.push('Missing traffic parameters for environmental impact assessment.');
      }
    } else if (claim.trigger?.type === 'high_pollution') {
      const pollution = claim.trigger.detectedValues?.pollution;
      const thresholds = claim.trigger.thresholds?.pollution;
      
      if (pollution && thresholds) {
        let maxPollutionRatio = 0;
        const pollutionDetails = [];
        
        if (pollution.aqi !== undefined && thresholds.aqi) {
          const ratio = getDisruptionRatio(pollution.aqi, thresholds.aqi);
          maxPollutionRatio = Math.max(maxPollutionRatio, ratio);
          pollutionDetails.push(`AQI: ${pollution.aqi} vs ${thresholds.aqi} threshold`);
          if (pollution.aqi >= thresholds.aqi) whyThisRecommendation.pollutionVerified = true;
        }
        if (pollution.pm25 !== undefined && thresholds.pm25) {
          const ratio = getDisruptionRatio(pollution.pm25, thresholds.pm25);
          maxPollutionRatio = Math.max(maxPollutionRatio, ratio);
          pollutionDetails.push(`PM2.5: ${pollution.pm25}µg/m³ vs ${thresholds.pm25}µg/m³ threshold`);
          if (pollution.pm25 >= thresholds.pm25) whyThisRecommendation.pollutionVerified = true;
        }
        
        environmentalImpactFactor = Math.min(1.0, maxPollutionRatio);
        explanation.push(`Pollution verification ratio: ${environmentalImpactFactor.toFixed(2)} (${pollutionDetails.join(', ')})`);
      } else {
        explanation.push('Missing pollution parameters for environmental impact assessment.');
      }
    } else {
      environmentalImpactFactor = 0.5; // Default moderate factor for unrest/others
      explanation.push(`Trigger type ${claim.trigger?.type || 'unknown'} processed with default impact factor 0.5.`);
    }

    // 3. Decoupled Compensation calculation
    const baseCoverage = claim.financial?.estimatedLoss?.totalLoss || 500;
    const maxPayoutPerClaim = policy.coverage?.maxPayoutPerClaim || 500;
    const effectiveBaseCoverage = Math.min(baseCoverage, maxPayoutPerClaim);
    const suggestedCompensation = Math.round(effectiveBaseCoverage * environmentalImpactFactor);

    // 4. Confidence Score (1 - fraudScore) * 100
    const confidenceScore = Math.round((1 - fraudScore) * 100);

    // 5. Claim History Score (0-100)
    let claimHistoryScore = 100;
    const historicalClaims = worker.riskProfile?.historicalClaims || {};
    if (historicalClaims.totalClaims > 0) {
      const approvalRatio = (historicalClaims.approvedClaims || 0) / historicalClaims.totalClaims;
      claimHistoryScore = Math.round(approvalRatio * 100);
      
      // Subtract points for rejected claims
      const rejectedClaims = historicalClaims.rejectedClaims || 0;
      claimHistoryScore = Math.max(0, claimHistoryScore - (rejectedClaims * 10));
      
      if (approvalRatio >= 0.7) {
        whyThisRecommendation.similarClaimsApproved = true;
      }
    } else {
      claimHistoryScore = 100;
      whyThisRecommendation.similarClaimsApproved = true; // Safe default
    }

    // 6. Composite Claim Reliability Score (0-100)
    const consensusScore = claim.validation?.consensusScore !== undefined ? claim.validation.consensusScore : 0.8;
    const triggerVerificationPart = Math.round(consensusScore * environmentalImpactFactor * 40);
    const coverageStatusPart = coverageActive ? 20 : 0;
    const fraudScorePart = Math.round((1 - fraudScore) * 20);
    const claimHistoryPart = Math.round((claimHistoryScore / 100) * 20);

    let reliabilityScore = triggerVerificationPart + coverageStatusPart + fraudScorePart + claimHistoryPart;

    // Apply business rules penalties to ensure accurate reliability
    if (!coverageActive) {
      reliabilityScore = Math.max(0, reliabilityScore - 30);
    }
    if (fraudScore >= 0.7) {
      reliabilityScore = Math.max(0, reliabilityScore - 40);
    } else if (fraudScore >= 0.4) {
      reliabilityScore = Math.max(0, reliabilityScore - 15);
    }

    // 7. Deterministic Explainable Rule Engine Decisions
    let decision = 'manual_review';
    if (!coverageActive) {
      decision = 'recommended_rejection';
      explanation.push('Recommended Rejection: Policy coverage is inactive or weekly premium is unpaid.');
    } else if (fraudScore >= 0.7) {
      decision = 'recommended_rejection';
      explanation.push(`Recommended Rejection: High fraud risk index detected (${(fraudScore * 100).toFixed(0)}%).`);
    } else if (environmentalImpactFactor < 0.15) {
      decision = 'recommended_rejection';
      explanation.push(`Recommended Rejection: Environmental sensor values are below trigger thresholds.`);
    } else if (coverageActive && fraudScore < 0.3 && environmentalImpactFactor >= 0.5) {
      decision = 'recommended_approval';
      explanation.push('Recommended Approval: Active policy verified, low fraud score, and strong environmental trigger match.');
    } else {
      decision = 'manual_review';
      explanation.push('Manual Review Required: Moderate metrics trigger standard review guidelines.');
    }

    // 8. Fraud Prevention Metrics
    const potentialFraudPrevented = decision === 'recommended_rejection' ? effectiveBaseCoverage : 0;
    const isFraudFlagged = fraudScore >= 0.4;
    const compensationSaved = decision === 'recommended_rejection' ? suggestedCompensation : 0;

    const endTime = Date.now();
    const decisionTimeMs = endTime - startTime;
    const isWithinSLA = decisionTimeMs < 300000; // 5-minute SLA

    return {
      decision,
      confidenceScore,
      reliabilityScore,
      suggestedCompensation,
      environmentalImpactFactor,
      whyThisRecommendation,
      explanation,
      decisionTimeMs,
      isWithinSLA,
      fraudPrevention: {
        potentialFraudPrevented,
        isFraudFlagged,
        compensationSaved
      },
      evaluatedAt: new Date()
    };
  }

  /**
   * Helper function to append an audit event onto the claim timeline.
   */
  logTimelineEvent(claim, event, status, metadata = {}) {
    if (!claim.timeline) {
      claim.timeline = [];
    }
    
    claim.timeline.push({
      event,
      status,
      timestamp: new Date(),
      metadata
    });
  }
}

module.exports = new RecommendationService();
