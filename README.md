# Hawk.ai - Automated Classroom Attendance System

Hawk.ai is an advanced, automated classroom attendance system powered by facial recognition technology. It streamlines the attendance process by detecting and identifying students in real-time, offering a seamless experience for both educators and administrators.

## Features
- **Real-Time Facial Recognition**: Accurately detects and identifies students from a live camera feed.
- **Burst Capture Mode**: Optimized for smartboard integration with 5-frame burst capture for enhanced recognition accuracy.
- **Live Monitoring Dashboard**: Provides a real-time view of the classroom with face bounding box overlays and attendance status, optimized for performance.
- **Smartboard Integration**: Native support for Raptor 65 smartboards with camera control (ADB/ONVIF), optical zoom, and tap-to-focus capabilities.
- **Camera Configuration**: Dedicated interface for setting up and testing camera connections, including ADB and ONVIF protocols.
- **Admin Dashboard**: Comprehensive interfaces for managing student data, viewing attendance statistics with dynamic data visualization, and monitoring system health.
- **Student Data Management**: Easy-to-use interface to register new students, organize them by classroom, update their profiles, and manage their face data.
- **Network Deployment Support**: Capable of ingesting RTSP streams (via MediaMTX and FFmpeg) for deployment over LAN in real-world classroom environments.
- **Modern UI/UX**: A responsive, modern user interface built with Next.js and Tailwind CSS featuring detailed dashboards and easy navigation.

## Technology Stack & Its Purpose

### Frontend Technologies
- **Next.js (React 19)**: Modern React framework used for server-side rendering and static site generation, ensuring fast load times, SEO optimization, and robust routing.
- **Tailwind CSS 4**: Utility-first CSS framework enabling rapid UI prototyping and ensuring a responsive, modern design without writing custom CSS.
- **Radix UI Components**: Unstyled, accessible component primitives (dialogs, dropdowns, etc.) that provide the foundation for custom-styled, highly accessible UI elements.
- **Recharts**: Composable charting library used to build the dynamic data visualization dashboards for attendance statistics and historical tracking.
- **Lucide React**: Comprehensive vector icon library providing clean, consistent imagery throughout the dashboard interface.

### Backend Technologies
- **FastAPI (Python)**: High-performance web framework used for building the RESTful API. It provides automatic interactive API documentation and fast asynchronous request routing.
- **InsightFace & ONNXRuntime**: State-of-the-art deep learning pipeline used for robust face detection and recognition. ONNXRuntime optimizes model inference speed for real-time processing.
- **OpenCV**: Computer vision library used for capturing RTSP streams, handling image frame transformations, and overlaying real-time bounding boxes and names.
- **SQLAlchemy (ORM)**: SQL toolkit and Object-Relational Mapper that manages the database schema, student profiles, and attendance records securely and efficiently.
- **Uvicorn**: Lightning-fast ASGI server used to serve the FastAPI application, enabling concurrent handling of API requests and continuous video stream processing.
- **NumPy**: Crucial for high-speed matrix multiplications used when comparing generated face embeddings against the student database via cosine similarity.
- **ADB & ONVIF Integration**: Camera control protocols for smartboard integration, enabling optical zoom, PTZ controls, and automated camera management.

## Getting Started

### Prerequisites
- Python 3.8+
- Node.js (v18+) & pnpm / npm
- FFmpeg (for RTSP stream handling)
- MediaMTX (for RTSP stream hosting - Optional depending on camera setup)
- ADB (Android Debug Bridge) for smartboard camera control (optional)

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

4. **Smartboard Setup (Optional)**
   For Raptor 65 smartboard integration:
   - Install ADB: Download from https://developer.android.com/tools/releases/platform-tools
   - Enable USB Debugging on the smartboard (Settings → Developer Options)
   - Set environment variable: `RAPTOR_IP=192.168.1.X` in backend/.env
   - Alternatively, configure via the web interface at `/smartboard/camera-config`

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
- **Smartboard Interface**: `http://localhost:3000/smartboard`
- **Camera Configuration**: `http://localhost:3000/smartboard/camera-config`

## Project Structure
- `/app`, `/components`, `/hooks`, `/lib`, `/public`, `/styles`: Next.js frontend application structure.
- `/backend`: FastAPI backend source, inference models, and API endpoints.
- `/admin dashboard`: Administrative UI assets and components.
- `start-hawk.ps1`: Startup script for minimal local setup.
- `start-hawk-lan.ps1`: Startup shell script tailored for LAN environments.

## License
This project is licensed under the MIT License - see the LICENSE file for details.
