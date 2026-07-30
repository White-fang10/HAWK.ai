# 🦅 Hawk.ai

### *The Future of Intelligent Classroom Attendance.*

<p align="center">

**Transforming classrooms with AI-powered facial recognition, real-time analytics, and smartboard automation.**

*No roll calls. No manual attendance. Just intelligent automation.*

</p>

---

## 🚀 Overview

**Hawk.ai** is an enterprise-grade AI attendance platform that automatically detects, recognizes, and records student attendance using real-time facial recognition.

Designed for modern educational institutions, Hawk.ai combines **Computer Vision**, **Artificial Intelligence**, and **Smart Classroom Integration** into one seamless platform.

Whether it's a single classroom or an entire campus, Hawk.ai eliminates manual attendance while providing educators with live insights and powerful analytics.

---

# ✨ Core Features

## 🎯 AI Face Recognition

* Real-time student detection
* High-accuracy face recognition
* Instant attendance recording
* Multi-face recognition support

---

## 📸 Burst Recognition Engine

Capture multiple frames within milliseconds for improved recognition accuracy.

✔ 5-Frame Burst Capture

✔ Motion Compensation

✔ Enhanced Recognition Confidence

---

## 🖥 Live Monitoring Dashboard

Monitor classrooms in real time with an interactive dashboard.

Features include:

* Live video feed
* Face bounding boxes
* Student identification
* Attendance status
* Recognition confidence
* System health monitoring

---

## 📚 Smart Classroom Integration

Built specifically for modern smart classrooms.

Supports:

* 📺 Raptor 65 Smartboards
* 📷 PTZ Camera Control
* 🔍 Optical Zoom
* 🎯 Tap-to-Focus
* 📡 ADB Integration
* 🌐 ONVIF Cameras

---

## 👨‍🏫 Administrative Portal

A centralized dashboard for managing the complete classroom ecosystem.

* Student Registration
* Classroom Management
* Attendance Reports
* Analytics Dashboard
* Face Dataset Management
* Camera Configuration
* Device Monitoring

---

## 📊 Intelligent Analytics

Gain meaningful insights through interactive dashboards.

Track:

* Daily Attendance
* Monthly Reports
* Student Attendance %
* Classroom Statistics
* Recognition Accuracy
* System Performance

---

## 🌐 Network Deployment Ready

Deploy Hawk.ai across an institution with ease.

Supports:

* RTSP Streams
* MediaMTX
* FFmpeg
* LAN Deployment
* Multiple Camera Sources

---

# ⚙ Technology Stack

## 🎨 Frontend

| Technology      | Purpose                |
| --------------- | ---------------------- |
| ⚛ Next.js 15    | Modern React Framework |
| 🎨 Tailwind CSS | Responsive UI          |
| 🧩 Radix UI     | Accessible Components  |
| 📈 Recharts     | Analytics Dashboard    |
| 🎯 Lucide Icons | Modern Iconography     |

---

## 🧠 AI & Backend

| Technology      | Purpose                 |
| --------------- | ----------------------- |
| ⚡ FastAPI       | REST API                |
| 👁 InsightFace  | Face Recognition        |
| 🚀 ONNX Runtime | High-Speed AI Inference |
| 📸 OpenCV       | Image Processing        |
| 🗄 SQLAlchemy   | Database ORM            |
| 🔢 NumPy        | Face Embeddings         |
| 🌐 Uvicorn      | ASGI Server             |

---

## 🔌 Smartboard Integration

* ADB Camera Control
* ONVIF Protocol
* Optical Zoom
* PTZ Support
* Automatic Camera Configuration

---

# 🏗 System Architecture

```text
        Camera / Smartboard
                 │
                 ▼
        Live Video Stream
                 │
                 ▼
     Face Detection (InsightFace)
                 │
                 ▼
      Face Embedding Generation
                 │
                 ▼
     Cosine Similarity Matching
                 │
                 ▼
    Attendance Verification Engine
                 │
                 ▼
      Database + Analytics Dashboard
```

---

# 🚀 Quick Start

## 1️⃣ Clone Repository

```bash
git clone <repository-url>

cd hawk.ai
```

---

## 2️⃣ Backend Setup

```bash
cd backend

python -m venv venv

# Windows
.\venv\Scripts\activate

pip install -r requirements.txt
```

Run Backend

```bash
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

---

## 3️⃣ Frontend Setup

```bash
npm install

npm run dev
```

or

```bash
pnpm install

pnpm run dev
```

---

# 🌐 Application Endpoints

| Service          | URL                                            |
| ---------------- | ---------------------------------------------- |
| 🌍 Frontend      | http://localhost:3000                          |
| ⚡ Backend API    | http://localhost:8000                          |
| 📺 Smartboard    | http://localhost:3000/smartboard               |
| 📷 Camera Config | http://localhost:3000/smartboard/camera-config |

---

# 📁 Project Structure

```text
hawk.ai
│
├── app/
├── components/
├── hooks/
├── lib/
├── public/
├── styles/
│
├── backend/
│   ├── AI Models
│   ├── FastAPI
│   ├── Face Recognition
│   └── API Routes
│
├── admin-dashboard/
│
├── start-hawk.ps1
├── start-hawk-lan.ps1
│
└── README.md
```

---

# 💡 Why Hawk.ai?

Traditional attendance systems waste valuable classroom time.

Hawk.ai replaces manual roll calls with intelligent automation powered by Computer Vision and Artificial Intelligence.

✅ Hands-Free Attendance

✅ Real-Time Recognition

✅ Smartboard Integration

✅ Enterprise Dashboard

✅ AI Analytics

✅ High-Speed Processing

✅ Campus Ready

---

# 🎯 Built For

🏫 Schools

🎓 Colleges

🏢 Universities

💼 Training Centers

🏛 Educational Institutions

---

# 🔮 Vision

*"To redefine classroom management through Artificial Intelligence, enabling educators to focus on teaching while Hawk.ai takes care of attendance with precision, speed, and intelligence."*

---

## ⭐ If you found this project interesting, consider giving it a star and supporting its development!
