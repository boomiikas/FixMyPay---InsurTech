const claimService = require('../services/claimService');
const fraudDetectionService = require('../services/fraudDetectionService');
const payoutService = require('../services/payoutService');
const { Claim, Policy } = require('../models');

// Get worker claims
const getWorkerClaims = async (req, res) => {
  try {
    const workerId = req.worker._id;
    const { status, limit = 10, page = 1 } = req.query;

    const result = await claimService.getWorkerClaims(workerId, { status, limit, page });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Get worker claims error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch claims'
    });
  }
};

// Get claim by ID
const getClaimById = async (req, res) => {
  try {
    const { claimId } = req.params;
    const workerId = req.worker._id;

    const claim = await claimService.getClaimById(claimId, workerId);
    
    if (!claim) {
      return res.status(404).json({
        success: false,
        message: 'Claim not found'
      });
    }

    res.json({
      success: true,
      data: claim
    });
  } catch (error) {
    console.error('Get claim by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch claim'
    });
  }
};

// Create manual claim (worker initiated)
const createManualClaim = async (req, res) => {
  return res.status(403).json({
    success: false,
    message: 'Manual claims are disabled. GigShield uses automatic parametric triggering and instant payouts.'
  });
};

// Retry failed payout
const retryPayout = async (req, res) => {
  try {
    const { claimId } = req.params;
    const workerId = req.worker._id;

    const claim = await claimService.getClaimById(claimId, workerId);
    if (!claim) {
      return res.status(404).json({
        success: false,
        message: 'Claim not found'
      });
    }

    const result = await payoutService.retryFailedPayout(claimId);

    res.json({
      success: result.success,
      message: result.success ? 'Payout retry initiated' : 'Payout retry failed',
      data: result
    });
  } catch (error) {
    console.error('Retry payout error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retry payout'
    });
  }
};

// Get claim analytics
const getClaimAnalytics = async (req, res) => {
  try {
    const workerId = req.worker._id;

    const claims = await claimService.getWorkerClaims(workerId, { limit: 1000 });
    const claimList = claims.claims;

    const analytics = {
      totalClaims: claimList.length,
      approvedClaims: claimList.filter(c => ['approved', 'paid'].includes(c.status.current)).length,
      rejectedClaims: claimList.filter(c => c.status.current === 'rejected').length,
      pendingClaims: claimList.filter(c => ['initiated', 'validating', 'under_review'].includes(c.status.current)).length,
      totalPayoutAmount: claimList
        .filter(c => c.financial?.payoutStatus === 'completed')
        .reduce((sum, c) => sum + (c.financial.payoutAmount || 0), 0),
      averageProcessingTime: claimList.length > 0 
        ? claimList.reduce((sum, c) => sum + (c.status.processingTime || 0), 0) / claimList.length 
        : 0,
      claimsByType: claimList.reduce((acc, claim) => {
        acc[claim.trigger.type] = (acc[claim.trigger.type] || 0) + 1;
        return acc;
      }, {})
    };

    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('Get claim analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch claim analytics'
    });
  }
};

// Admin: Get all claims
const getAllClaims = async (req, res) => {
  try {
    const { status, limit = 20, page = 1, workerId } = req.query;

    const Claim = require('../models').Claim;
    const query = {};
    if (status) query['status.current'] = status;
    if (workerId) query.workerId = workerId;

    const claims = await Claim.find(query)
      .sort({ 'metadata.createdAt': -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('policyId', 'policyNumber')
      .populate('workerId', 'personalInfo.firstName personalInfo.lastName personalInfo.email');

    const total = await Claim.countDocuments(query);

    res.json({
      success: true,
      data: {
        claims,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get all claims error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch claims'
    });
  }
};

// Admin: Get claims for review
const getClaimsForReview = async (req, res) => {
  try {
    const { limit = 20, page = 1 } = req.query;

    const result = await claimService.getClaimsForReview({ limit, page });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Get claims for review error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch claims for review'
    });
  }
};

// Admin: Review claim
const reviewClaim = async (req, res) => {
  try {
    const { claimId } = req.params;
    const { decision, notes } = req.body;
    const adminId = req.admin._id;

    const claim = await claimService.reviewClaim(claimId, adminId, decision, notes);

    res.json({
      success: true,
      message: `Claim ${decision}d successfully`,
      data: claim
    });
  } catch (error) {
    console.error('Review claim error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to review claim'
    });
  }
};

// Admin: Get fraud statistics
const getFraudStatistics = async (req, res) => {
  try {
    const { timeRange = '30d' } = req.query;

    const stats = await fraudDetectionService.getFraudStatistics(timeRange);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Get fraud statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch fraud statistics'
    });
  }
};

// Admin: Analyze worker
const analyzeWorker = async (req, res) => {
  try {
    const { workerId } = req.params;

    const analysis = await fraudDetectionService.analyzeWorker(workerId);

    res.json({
      success: true,
      data: analysis
    });
  } catch (error) {
    console.error('Analyze worker error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to analyze worker'
    });
  }
};

// Admin: Get payout statistics
const getPayoutStatistics = async (req, res) => {
  try {
    const { timeRange = '30d' } = req.query;

    const stats = await payoutService.getPayoutStatistics(timeRange);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Get payout statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payout statistics'
    });
  }
};

// Admin: Process batch payouts
const processBatchPayouts = async (req, res) => {
  try {
    const { claimIds } = req.body;

    if (!claimIds || !Array.isArray(claimIds)) {
      return res.status(400).json({
        success: false,
        message: 'Claim IDs array is required'
      });
    }

    const results = await payoutService.processBatchPayouts(claimIds);

    res.json({
      success: true,
      message: 'Batch payout processing completed',
      data: results
    });
  } catch (error) {
    console.error('Process batch payouts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process batch payouts'
    });
  }
};

// Admin: Process refund
const processRefund = async (req, res) => {
  try {
    const { claimId } = req.params;
    const { reason } = req.body;

    const result = await payoutService.processRefund(claimId, reason);

    res.json({
      success: result.success,
      message: result.success ? 'Refund processed successfully' : 'Refund processing failed',
      data: result
    });
  } catch (error) {
    console.error('Process refund error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process refund'
    });
  }
};

// Get payout status
const getPayoutStatus = async (req, res) => {
  try {
    const { transactionId } = req.params;

    const status = await payoutService.getPayoutStatus(transactionId);

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('Get payout status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payout status'
    });
  }
};

// Get AI recommendation details
const getClaimRecommendation = async (req, res) => {
  try {
    const { claimId } = req.params;
    const claim = await claimService.getClaimById(claimId);

    if (!claim) {
      return res.status(404).json({
        success: false,
        message: 'Claim not found'
      });
    }

    if (!claim.ecdeDetails || !claim.ecdeDetails.decision) {
      return res.status(404).json({
        success: false,
        message: 'Claim decision recommendation details not found. Run validation first.'
      });
    }

    res.json({
      success: true,
      data: {
        claimId: claim._id,
        claimNumber: claim.claimNumber,
        reliabilityScore: claim.ecdeDetails.reliabilityScore,
        confidenceScore: claim.ecdeDetails.confidenceScore,
        suggestedCompensation: claim.ecdeDetails.suggestedCompensation,
        recommendation: claim.ecdeDetails.decision === 'recommended_approval'
          ? 'Recommended Approval'
          : claim.ecdeDetails.decision === 'manual_review'
            ? 'Manual Review Required'
            : 'Recommended Rejection',
        whyThisRecommendation: claim.ecdeDetails.whyThisRecommendation,
        explanations: claim.ecdeDetails.explanation,
        evaluatedAt: claim.ecdeDetails.evaluatedAt
      }
    });
  } catch (error) {
    console.error('Get claim recommendation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch recommendation details'
    });
  }
};

// Force evaluate/re-run ECDE (Admin only)
const forceEvaluateECDE = async (req, res) => {
  try {
    const { claimId } = req.params;
    
    // Fetch and validate
    const updatedClaim = await claimService.validateClaim(claimId);

    res.json({
      success: true,
      message: 'ECDE evaluated successfully',
      data: updatedClaim
    });
  } catch (error) {
    console.error('Force evaluate ECDE error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to evaluate ECDE'
    });
  }
};

// Get claim journey timeline
const getClaimTimeline = async (req, res) => {
  try {
    const { claimId } = req.params;
    const claim = await Claim.findById(claimId).select('timeline claimNumber status');

    if (!claim) {
      return res.status(404).json({
        success: false,
        message: 'Claim not found'
      });
    }

    res.json({
      success: true,
      data: {
        claimNumber: claim.claimNumber,
        status: claim.status.current,
        timeline: claim.timeline || []
      }
    });
  } catch (error) {
    console.error('Get claim timeline error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch timeline details'
    });
  }
};

// Get advanced dashboard metrics for ECDE (Admin widgets)
const getAdminDashboardWidgets = async (req, res) => {
  try {
    // 1. Workers protected (distinct workerIds with active policies)
    const activeWorkersCount = await Policy.distinct('workerId', { 'status.current': 'active' });
    const workersProtected = activeWorkersCount.length;

    // 2. Count metrics from Claim collection
    const totalClaims = await Claim.countDocuments({});
    
    // Recommended count categories
    const recApprovalCount = await Claim.countDocuments({ 'ecdeDetails.decision': 'recommended_approval' });
    const recReviewCount = await Claim.countDocuments({ 'ecdeDetails.decision': 'manual_review' });
    const recRejectionCount = await Claim.countDocuments({ 'ecdeDetails.decision': 'recommended_rejection' });

    // Actual decision counts
    const approvedCount = await Claim.countDocuments({ 'status.current': { $in: ['approved', 'paid'] } });
    const underReviewCount = await Claim.countDocuments({ 'status.current': 'under_review' });
    const rejectedCount = await Claim.countDocuments({ 'status.current': 'rejected' });

    // 3. Compensation aggregations
    const compensationStats = await Claim.aggregate([
      {
        $group: {
          _id: null,
          totalRecommended: { $sum: '$ecdeDetails.suggestedCompensation' },
          avgRecommended: { $avg: '$ecdeDetails.suggestedCompensation' },
          totalPaid: {
            $sum: {
              $cond: [
                { $eq: ['$status.current', 'paid'] },
                '$financial.payoutAmount',
                0
              ]
            }
          },
          incomeProtected: {
            $sum: {
              $cond: [
                { $in: ['$status.current', ['approved', 'paid']] },
                '$ecdeDetails.suggestedCompensation',
                0
              ]
            }
          },
          totalFraudPrevented: { $sum: '$ecdeDetails.fraudPrevention.potentialFraudPrevented' },
          totalCompensationSaved: { $sum: '$ecdeDetails.fraudPrevention.compensationSaved' },
          avgReliability: { $avg: '$ecdeDetails.reliabilityScore' }
        }
      }
    ]);

    const stats = compensationStats[0] || {
      totalRecommended: 0,
      avgRecommended: 0,
      totalPaid: 0,
      incomeProtected: 0,
      totalFraudPrevented: 0,
      totalCompensationSaved: 0,
      avgReliability: 0
    };

    // 4. Operational processing speed / SLA metrics
    const speedStats = await Claim.aggregate([
      {
        $match: { 'ecdeDetails.decisionTimeMs': { $exists: true } }
      },
      {
        $group: {
          _id: null,
          avgTime: { $avg: '$ecdeDetails.decisionTimeMs' },
          minTime: { $min: '$ecdeDetails.decisionTimeMs' },
          maxTime: { $max: '$ecdeDetails.decisionTimeMs' },
          slaCompliant: {
            $sum: {
              $cond: [
                { $eq: ['$ecdeDetails.isWithinSLA', true] },
                1,
                0
              ]
            }
          },
          totalWithSpeed: { $sum: 1 }
        }
      }
    ]);

    const speeds = speedStats[0] || {
      avgTime: 0,
      minTime: 0,
      maxTime: 0,
      slaCompliant: 0,
      totalWithSpeed: 0
    };

    // Calculate admin review queue time bottlenecks
    const queueTimes = await Claim.aggregate([
      {
        $match: {
          'status.current': { $in: ['approved', 'rejected', 'paid'] },
          'ecdeDetails.evaluatedAt': { $exists: true }
        }
      },
      {
        $project: {
          durationMs: {
            $subtract: [
              {
                $cond: [
                  { $gt: ['$status.paidAt', null] },
                  '$status.paidAt',
                  {
                    $cond: [
                      { $gt: ['$status.approvedAt', null] },
                      '$status.approvedAt',
                      '$status.rejectedAt'
                    ]
                  }
                ]
              },
              '$ecdeDetails.evaluatedAt'
            ]
          }
        }
      },
      {
        $group: {
          _id: null,
          avgQueueTime: { $avg: '$durationMs' }
        }
      }
    ]);

    const avgQueueTimeMs = queueTimes[0]?.avgQueueTime || 0;

    // SLA compliance rate
    const slaComplianceRate = speeds.totalWithSpeed > 0
      ? ((speeds.slaCompliant / speeds.totalWithSpeed) * 100).toFixed(1)
      : '100.0';

    res.json({
      success: true,
      data: {
        businessImpact: {
          workersProtected,
          totalClaims,
          claimsApproved: approvedCount,
          claimsUnderReview: underReviewCount,
          claimsRejected: rejectedCount,
          claimsRecommendedApproval: recApprovalCount,
          claimsRecommendedReview: recReviewCount,
          claimsRecommendedRejection: recRejectionCount,
          incomeProtected: Math.round(stats.incomeProtected),
          fraudPrevented: Math.round(stats.totalFraudPrevented || stats.totalCompensationSaved),
          totalCompensationPaid: Math.round(stats.totalPaid),
          totalRecommendedCompensation: Math.round(stats.totalRecommended),
          averageCompensationPerClaim: Math.round(stats.avgRecommended),
          averageReliabilityScore: Math.round(stats.avgReliability || 0)
        },
        operationalEfficiency: {
          averageClaimProcessingTimeSec: speeds.totalWithSpeed > 0 ? (speeds.avgTime / 1000).toFixed(2) : '0.00',
          fastestClaimProcessingTimeSec: speeds.totalWithSpeed > 0 ? (speeds.minTime / 1000).toFixed(2) : '0.00',
          slowestClaimProcessingTimeSec: speeds.totalWithSpeed > 0 ? (speeds.maxTime / 1000).toFixed(2) : '0.00',
          averageAdminQueueTimeMin: avgQueueTimeMs > 0 ? (avgQueueTimeMs / (1000 * 60)).toFixed(1) : '0.0',
          slaComplianceRatePercent: parseFloat(slaComplianceRate)
        }
      }
    });
  } catch (error) {
    console.error('Get admin dashboard widgets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard statistics'
    });
  }
};

module.exports = {
  getWorkerClaims,
  getClaimById,
  createManualClaim,
  retryPayout,
  getClaimAnalytics,
  getAllClaims,
  getClaimsForReview,
  reviewClaim,
  getFraudStatistics,
  analyzeWorker,
  getPayoutStatistics,
  processBatchPayouts,
  processRefund,
  getPayoutStatus,
  getClaimRecommendation,
  forceEvaluateECDE,
  getClaimTimeline,
  getAdminDashboardWidgets
};
