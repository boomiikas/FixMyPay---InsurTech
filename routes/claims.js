const express = require('express');
const router = express.Router();
const claimController = require('../controllers/claimController');
const { authenticateWorker, authenticateAdmin, authorize } = require('../middleware/auth');

// Worker Routes
router.get('/', authenticateWorker, claimController.getWorkerClaims);
router.get('/analytics', authenticateWorker, claimController.getClaimAnalytics);
router.get('/:claimId', authenticateWorker, claimController.getClaimById);
router.get('/:claimId/recommendation', authenticateWorker, claimController.getClaimRecommendation);
router.get('/:claimId/timeline', authenticateWorker, claimController.getClaimTimeline);
router.post('/', authenticateWorker, claimController.createManualClaim);
router.post('/:claimId/retry-payout', authenticateWorker, claimController.retryPayout);

// Common Routes
router.get('/payout/:transactionId/status', claimController.getPayoutStatus);

// Admin Routes
router.get('/admin/all', authenticateAdmin, authorize(['view_claims']), claimController.getAllClaims);
router.get('/admin/dashboard/widgets', authenticateAdmin, authorize(['view_claims']), claimController.getAdminDashboardWidgets);
router.get('/admin/review', authenticateAdmin, authorize(['investigate_claims']), claimController.getClaimsForReview);
router.get('/admin/:claimId/recommendation', authenticateAdmin, authorize(['view_claims']), claimController.getClaimRecommendation);
router.get('/admin/:claimId/timeline', authenticateAdmin, authorize(['view_claims']), claimController.getClaimTimeline);
router.post('/admin/:claimId/recommend', authenticateAdmin, authorize(['investigate_claims']), claimController.forceEvaluateECDE);
router.post('/admin/:claimId/review', authenticateAdmin, authorize(['investigate_claims']), claimController.reviewClaim);
router.get('/admin/fraud/statistics', authenticateAdmin, authorize(['view_claims']), claimController.getFraudStatistics);
router.get('/admin/worker/:workerId/analyze', authenticateAdmin, authorize(['investigate_claims']), claimController.analyzeWorker);
router.get('/admin/payout/statistics', authenticateAdmin, authorize(['view_claims']), claimController.getPayoutStatistics);
router.post('/admin/payout/batch', authenticateAdmin, authorize(['approve_claims']), claimController.processBatchPayouts);
router.post('/admin/:claimId/refund', authenticateAdmin, authorize(['approve_claims']), claimController.processRefund);

module.exports = router;
