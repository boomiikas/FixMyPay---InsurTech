# FixMyPay - Explainable, Auditable, Parametric Insurance Decision Platform for Gig Workers

FixMyPay is an AI-powered micro-insurance platform designed for platform-based delivery partners. It enables zero-touch, objective claim verification and payout decisions using weather, pollution, and traffic sensor data. 

The platform features a transparent **Explainable Claim Decision Engine (ECDE)** and an immutable **Claim Timeline & Audit Trail** for full regulatory compliance and human-in-the-loop control.

---

## 🚀 Key Features

- **Explainable Claim Decision Engine (ECDE):** Replaces legacy black-box automation with deterministic, audit-friendly rules verifying coverage active status, fraud probability, and threshold-activated environmental triggers.
- **Claim Timeline & Audit Trail:** Immutable stage logging that records weather verification, traffic congestion ratios, fraud score metrics, reliability scoring, and admin approvals step-by-step.
- **Real-Time Parametric Sensors:** Validates claims using OpenWeather, OpenAQ, and Google Maps API data against policy thresholds.
- **Anti-Spoofing & Fraud Detection:** Runs parallel rule checks and an AdaBoost ML model evaluating GPS spoofing, delivery active states, and unusual frequencies.
- **Business Impact Dashboard:** Tracks advanced KPIs such as Workers Protected, Income Protected, prevented fraud amounts, processing SLAs, and review queue bottleneck metrics.

---

## 🏗️ Technical Stack

- **Frontend:** React.js, Tailwind CSS, React Router, Axios.
- **Backend:** Node.js, Express.js.
- **Database:** MongoDB (with Mongoose ODM).
- **Caching & Runtime Logs:** Redis.
- **Fraud ML Engine:** Python 3 (AdaBoost model).
- **Orchestration:** Docker Compose.

---

## 🛠️ Getting Started (Docker Setup)

The recommended way to run FixMyPay is using Docker. No local Node.js, MongoDB, Redis, or Python environment is needed on your host system.

### 1. Prerequisites

Ensure you have installed:
- [Git](https://git-scm.com/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

Verify they are running:
```bash
docker --version
docker compose version
```

### 2. Configure Environment

Copy `.env.example` to create a `.env` file in the root folder:

**Windows PowerShell:**
```powershell
Copy-Item .env.example .env
```

**macOS/Linux:**
```bash
cp .env.example .env
```

*Note: For local demo mode, keep `UPI_FAKE_MODE=true` to process simulated payouts instantly.*

### 3. Run the Stack

Start Docker Desktop, then execute the following build command:

```bash
docker compose up -d --build mongodb redis backend frontend
```

This starts only the core services needed to run the application, avoiding Nginx SSL port mapping issues on local machines.

To check container health status:
```bash
docker compose ps
```

---

## 🌐 Access Points & Demo Credentials

### Worker Portal
- **URL:** [http://localhost:3001](http://localhost:3001)
- **Login:** `worker@gigshield.com` / `applein12`
- **Features:** Monitor environmental threat levels, pay weekly premiums, view active weekly coverages, and trigger parametric claims.

### Admin Portal
- **URL:** [http://localhost:3001/admin](http://localhost:3001/admin)
- **Login:** `admin@gigshield.com` / `the34eye`
- **Features:** Review the advanced ECDE dashboard, view the pending claim review queue, check fraud audits, run simulated disruptions, and approve suggested payouts.

### API Entry points
- **Backend Base API:** `http://localhost:5000/api`
- **Health Check:** `http://localhost:5000/api/health`

---

## 🧪 Seeding & Test Verification

### Seed Demo Accounts
To seed or reset default demo credentials (worker and admin accounts) in your local database, run:
```bash
docker compose exec backend node scripts/seedDemoUsers.js
```

### Run ECDE Rule Engine Unit Tests
To test the ECDE rule logic, reliability calculations, and timeline audits without needing to boot database containers, you can execute the unit test script:
```bash
node scripts/testRecommendationEngine.js
```

Expected output includes detailed checkmark results for:
- [✓] Weather Verification (Rainfall ratio check)
- [✓] Coverage Active (Subscription status check)
- [✓] Low Fraud Probability (Risk score threshold)
- [✓] Step-by-Step Claim Timeline trace

---

## 📊 Useful Docker Commands

- **View backend server logs:** `docker compose logs -f backend`
- **View frontend client logs:** `docker compose logs -f frontend`
- **Restart Backend:** `docker compose restart backend`
- **Reset Stack (containers + volumes):**
  ```bash
  docker compose down -v
  docker compose up -d --build mongodb redis backend frontend
  ```
