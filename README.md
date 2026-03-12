# Hawk.ai - Automated Classroom Attendance System

Hawk.ai is an advanced, automated classroom attendance system powered by facial recognition technology. It streamlines the attendance process by detecting and identifying students in real-time, offering a seamless experience for both educators and administrators.

## Features
- **Real-Time Facial Recognition**: Accurately detects and identifies students from a live camera feed.
- **Live Monitoring Dashboard**: Provides a real-time view of the classroom with face bounding box overlays and attendance status, optimized for performance.
- **Admin Dashboard**: Comprehensive interfaces for managing student data, viewing attendance statistics with dynamic data visualization, and monitoring system health.
- **Student Data Management**: Easy-to-use interface to register new students, organize them by classroom, update their profiles, and manage their face data.
- **Network Deployment Support**: Capable of ingesting RTSP streams (via MediaMTX and FFmpeg) for deployment over LAN in real-world classroom environments.
- **Modern UI/UX**: A responsive, modern user interface built with Next.js and Tailwind CSS featuring detailed dashboards and easy navigation.

## Tech Stack
### Frontend
- Next.js (React 19)
- Tailwind CSS 4
- Radix UI Components
- Recharts (for Data Visualization)
- Lucide React (Icons)

### Backend
- FastAPI (Python)
- OpenCV / Deep Learning pipelines (for Face Detection & Recognition)
- Uvicorn (ASGI server)

## Getting Started

### Prerequisites
- Python 3.8+
- Node.js (v18+) & pnpm / npm
- FFmpeg (for RTSP stream handling)
- MediaMTX (for RTSP stream hosting - Optional depending on camera setup)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd hawk.ai
   ```

2. **Backend Setup**
   Ensure you have a virtual environment set up and the required Python packages installed.
   ```bash
   cd backend
   python -m venv venv
   # Activate the virtual environment:
   # On Windows:
   .\venv\Scripts\activate
   # On Linux/macOS:
   # source venv/bin/activate
   pip install -r requirements.txt
   cd ..
   ```

3. **Frontend Setup**
   Install the necessary Node.js dependencies.
   ```bash
   npm install
   # or if using pnpm
   pnpm install
   ```

### Running the Application

To start both the FastAPI backend and Next.js frontend concurrently, you can use the provided PowerShell helper scripts on Windows:

**For Local Development:**
```powershell
.\start-hawk.ps1
```

**For Local Area Network (LAN) Deployment:**
```powershell
.\start-hawk-lan.ps1
```

Alternatively, you can start them manually:

1. **Start Backend**:
   ```bash
   cd backend
   .\venv\Scripts\activate
   python -m uvicorn main:app --host 0.0.0.0 --port 8000
   ```

2. **Start Frontend**:
   ```bash
   npm run dev
   # or
   pnpm run dev
   ```

Once started, the services will be available at:
- **Frontend Dashboard**: `http://localhost:3000`
- **Backend API**: `http://localhost:8000`

## Project Structure
- `/app`, `/components`, `/hooks`, `/lib`, `/public`, `/styles`: Next.js frontend application structure.
- `/backend`: FastAPI backend source, inference models, and API endpoints.
- `/admin dashboard`: Administrative UI assets and components.
- `start-hawk.ps1`: Startup script for minimal local setup.
- `start-hawk-lan.ps1`: Startup shell script tailored for LAN environments.

## License
This project is licensed under the MIT License - see the LICENSE file for details.
