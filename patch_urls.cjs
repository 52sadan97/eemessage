const fs = require('fs');

try {
  // 1. App.jsx
  let appFile = fs.readFileSync('src/App.jsx', 'utf8');
  if (!appFile.includes('./config')) {
    appFile = appFile.replace(/import \{ io \} from 'socket\.io-client';/, "import { io } from 'socket.io-client';\nimport { API_URL } from './config';");
    appFile = appFile.replace(/const socket = io\('http:\/\/localhost:3001',/g, "const socket = io(API_URL,");
    appFile = appFile.replace(/'http:\/\/localhost:3001\/api/g, "`\\${API_URL}/api");
    fs.writeFileSync('src/App.jsx', appFile);
  }

  // 2. Auth.jsx
  if (fs.existsSync('src/components/Auth.jsx')) {
    let authFile = fs.readFileSync('src/components/Auth.jsx', 'utf8');
    if (!authFile.includes('../config')) {
      authFile = authFile.replace(/import \{ useState \} from 'react';/, "import { useState } from 'react';\nimport { API_URL } from '../config';");
      authFile = authFile.replace(/'http:\/\/localhost:3001\/api/g, "`\\${API_URL}/api");
      fs.writeFileSync('src/components/Auth.jsx', authFile);
    }
  }

  // 3. ProfileModal.jsx
  let profileFile = fs.readFileSync('src/components/ProfileModal.jsx', 'utf8');
  if (!profileFile.includes('../config')) {
    profileFile = profileFile.replace(/import \{ useState, useRef \} from 'react';/, "import { useState, useRef } from 'react';\nimport { API_URL, getMediaUrl } from '../config';");
    profileFile = profileFile.replace(/'http:\/\/localhost:3001\/api/g, "`\\${API_URL}/api");
    profileFile = profileFile.replace(/src={avatar \|\|/g, "src={getMediaUrl(avatar) ||");
    fs.writeFileSync('src/components/ProfileModal.jsx', profileFile);
  }

  // 4. ChatArea.jsx
  let chatFile = fs.readFileSync('src/components/ChatArea.jsx', 'utf8');
  if (!chatFile.includes('../config')) {
    chatFile = chatFile.replace(/import \{ useRef, useEffect, useState \} from 'react';/, "import { useRef, useEffect, useState } from 'react';\nimport { API_URL, getMediaUrl } from '../config';");
    chatFile = chatFile.replace(/'http:\/\/localhost:3001\/api/g, "`\\${API_URL}/api");
    chatFile = chatFile.replace(/src={msg\.mediaUrl}/g, "src={getMediaUrl(msg.mediaUrl)}");
    fs.writeFileSync('src/components/ChatArea.jsx', chatFile);
  }

  // 5. server/index.js
  let serverFile = fs.readFileSync('server/index.js', 'utf8');
  serverFile = serverFile.replace(
    /const fileUrl = `http:\/\/localhost:3001\/uploads\/\$\{folder\}\/\$\{req\.file\.filename\}`;/g,
    "const fileUrl = `/uploads/${folder}/${req.file.filename}`;"
  );
  fs.writeFileSync('server/index.js', serverFile);

  console.log("Successfully patched hardcoded localhost URLs to dynamic network-aware API URLs!");
} catch (error) {
  console.error("Patching failed:", error);
}
