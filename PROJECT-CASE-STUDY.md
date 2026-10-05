# Project Case Study

## Jeyo's Hardhit Fitness Center — Gym Management & Attendance System

**Original Creator & Developer: Blenda Saragena**

### Project Overview

A full-stack gym management and attendance system designed and developed for Jeyo's Hardhit Fitness Center.

The system combines a responsive web interface, Java local server, SQLite database, QR/barcode scanning, membership management, attendance tracking, and Android deployment into one integrated solution.

### Problem

The gym needed a practical system for managing members, memberships, renewals, attendance, and member identification without depending entirely on cloud services or expensive third-party systems.

### Solution

I designed and developed a custom gym management system that provides:

- Member registration and management
- Membership expiry and renewal tracking
- QR/barcode member identification
- Hardware scanner integration
- Attendance validation
- Daily attendance logs
- Admin dashboard
- Remote administration over a local network
- SQLite database storage
- Android APK deployment
- Offline/local-network operation

### System Architecture

The application uses several integrated layers:

**Frontend**
- HTML
- CSS
- JavaScript
- Responsive gym management interface

**Backend**
- Java local HTTP server
- REST-style API endpoints
- Local network communication

**Database**
- SQLite
- Member records
- Membership information
- Attendance records

**Android**
- Android WebView
- Java application wrapper
- Local server hosted directly on the Android device

### Frontend Development

The interface was developed from scratch with a focus on usability in a real gym environment.

Major interfaces include:

- Member check-in
- Admin dashboard
- Member management
- Registration
- Membership renewal
- Membership status
- Attendance records

The interface uses a yellow-and-black visual theme with responsive layouts designed for mobile devices.

### Backend Development

A Java-based local HTTP server handles communication between the frontend and SQLite database.

The server provides API functionality for:

- Administrator authentication
- Member CRUD operations
- Member ID generation and regeneration
- Attendance recording
- Attendance retrieval
- Membership validation
- Database backup and restore
- Health checks
- Receipt/print functionality

### Database

SQLite was selected to keep the system lightweight and suitable for local/offline operation.

The database stores structured member and attendance information while avoiding the need for an external database server.

The portfolio version contains fictional demo data only.

### QR / Barcode Scanner Integration

The system supports QR/barcode-based member identification.

The scanner integration includes:

- QR code scanning
- Hardware barcode scanner input
- Member ID detection
- Membership validation
- Duplicate attendance prevention
- Success and access-denied notifications
- Audio feedback

### Membership Validation

Before recording attendance, the system checks the member's status and membership validity.

This helps prevent unauthorized access and gives gym staff immediate feedback when a member scans.

### Android Deployment

The web application was packaged into an Android application using a Java WebView wrapper.

The Android application includes the local server and database integration, allowing the system to operate directly from an Android device.

### Remote Administration

The system supports a local-network administration workflow.

One Android device can host the main gym system while another device on the same network can access the administrator interface.

This allows gym staff to perform administrative tasks without interrupting the main check-in station.

### Development Environment

The project was developed primarily using Android-based development tools, including:

- Acode
- Termux
- Java
- HTML
- CSS
- JavaScript
- SQLite
- Gradle
- Android SDK

The development workflow demonstrates the ability to build, test, debug, and package a full-stack Android application without relying on a traditional desktop development environment.

### Engineering Challenges

Important development challenges included:

- Running a local HTTP server inside Android
- Maintaining a shared SQLite database
- Supporting local-network administration
- Integrating hardware scanner input
- Preventing duplicate attendance
- Validating membership expiry
- Packaging the web application as an Android APK
- Maintaining functionality during offline/local-network operation
- Keeping the production system separate from the sanitized portfolio version

### Result

The completed system provides a unified solution for gym membership management and attendance tracking.

It demonstrates practical experience across:

- Frontend development
- Backend development
- Database design
- Android development
- API integration
- QR/barcode scanning
- Local networking
- Authentication
- Responsive UI development
- Application deployment

### Developer Role

**Blenda Saragena — Original Creator & Developer**

Responsibilities included system planning, interface design, frontend development, backend development, database integration, scanner integration, Android packaging, testing, debugging, and deployment.

### Portfolio Presentation

Recommended portfolio materials include:

1. Project overview screenshot
2. Admin dashboard screenshot
3. Member management screenshot
4. Registration/renewal screenshot
5. QR/barcode scanning demonstration
6. System architecture diagram
7. Short demonstration video

### Privacy / Demo Data

The public portfolio version has been sanitized for demonstration purposes.

Production member information, operational credentials, private backups, and other sensitive files are not included.

The included database contains fictional demonstration members and attendance records only.
