# 💬 EEMessage — Modern Mesajlaşma Uygulaması

<p align="center">
  <strong>Instagram DM tarzı, mobil uyumlu, gerçek zamanlı mesajlaşma platformu</strong>
</p>

---

## ✨ Özellikler

### 💬 Mesajlaşma
- ⚡ **Gerçek zamanlı** mesajlaşma (Socket.IO)
- ✅ Mesaj durumu takibi (gönderildi → iletildi → okundu)
- 🎤 **Sesli mesaj** kaydı ve gönderimi
- 😊 **Emoji seçici** entegrasyonu
- 🗑️ Herkesten silme ve benim için silme
- 📎 Sohbet geçmişi temizleme

### 📁 Dosya Paylaşımı
- 📄 **Tüm dosya türleri**: PDF, Word, Excel, ZIP, RAR, PPT ve daha fazlası
- 🖼️ Resim ve video gönderimi
- 📹 **Kameradan anlık video** çekim ve gönderme
- 🎵 Sesli mesaj kayıt ve oynatma
- 💾 100MB'a kadar dosya yükleme desteği

### 📞 Sesli & Görüntülü Arama
- 🔗 **WebRTC P2P** bağlantı (simple-peer)
- 📹 Görüntülü arama
- 📞 Sesli arama
- 🔇 Mikrofon sessize alma
- 📷 Kamera açma/kapama
- ⏱️ 30 saniye cevapsız arama timeout'u
- 💬 Cevapsız arama mesajı otomatik gönderimi
- 🌐 Çevrimdışı kullanıcılara da arama başlatabilme

### 👤 Profil Yönetimi
- 🖼️ Profil fotoğrafı yükleme ve değiştirme
- ✏️ İsim güncelleme
- 🔒 Şifre değiştirme
- 🔍 Karşı tarafın profil fotoğrafını büyütme (lightbox)

### 🎨 Arayüz
- 📱 **Mobil uyumlu** Instagram DM tarzı tasarım
- 🌙 Karanlık / ☀️ Aydınlık tema desteği
- ⌨️ Mobilde klavye üstünde sabit input bar
- 🔔 Bildirimler (Notification API)
- 📲 PWA desteği (Ana ekrana eklenebilir)

---

## 🛠️ Teknolojiler

| Katman | Teknoloji |
|--------|-----------|
| **Frontend** | React, Vite, Lucide Icons, Emoji Picker React |
| **Backend** | Node.js, Express, Socket.IO |
| **Veritabanı** | SQLite (better-sqlite3) |
| **WebRTC** | simple-peer, Google STUN sunucuları |
| **Deployment** | Docker, Docker Compose, Nginx |

---

## 🚀 Kurulum

### Gereksinimler
- [Docker](https://www.docker.com/get-started) (20.10+)
- [Docker Compose](https://docs.docker.com/compose/) (v2+)

### 1. Repoyu Klonla

```bash
git clone https://github.com/52sadan97/eemessage.git
cd eemessage
```

### 2. Uygulamayı Başlat

```bash
docker-compose up --build -d
```

Bu komut:
- Backend API sunucusunu (Express + Socket.IO) başlatır
- Frontend'i (React + Vite) build edip Nginx ile servis eder
- SQLite veritabanını otomatik oluşturur

### 3. Tarayıcıdan Eriş

| Servis | URL | Açıklama |
|--------|-----|----------|
| 🌐 Web Arayüzü | `http://localhost:7010` | Mesajlaşma uygulaması |
| ⚙️ API Sunucusu | `http://localhost:3010` | Backend API + Socket.IO |

---

## 🔧 Yapılandırma

### Ortam Değişkenleri

`docker-compose.yml` dosyasında:

```yaml
environment:
  - BACKEND_URL=http://localhost:3010
```

> **Production'da** `localhost` yerine sunucu IP/domain adresinizi yazın:
> ```yaml
> - BACKEND_URL=https://eemessage.example.com:3010
> ```

### Port Değiştirme

```yaml
ports:
  - "7010:80"   # Web arayüzü (değiştirmek için soldaki portu değiştirin)
  - "3010:3010" # API sunucusu
```

---

## 🖥️ Production Deployment

### Sunucuya Kurulum

```bash
# 1. Repoyu klonla
cd /opt
git clone https://github.com/52sadan97/eemessage.git
cd eemessage

# 2. Build ve başlat
docker-compose up --build -d

# 3. Firewall portlarını aç (Ubuntu/Debian)
sudo ufw allow 7010
sudo ufw allow 3010
```

### Nginx Reverse Proxy (HTTPS)

Domain adınız varsa, SSL ile kullanmak için:

```nginx
server {
    listen 80;
    server_name eemessage.example.com;

    # Web arayüzü
    location / {
        proxy_pass http://localhost:7010;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Socket.IO (WebSocket desteği)
    location /socket.io/ {
        proxy_pass http://localhost:3010;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    # API
    location /api/ {
        proxy_pass http://localhost:3010;
        proxy_set_header Host $host;
    }

    # Uploads (Profil resimleri, medya dosyaları)
    location /uploads/ {
        proxy_pass http://localhost:3010;
    }
}
```

SSL sertifikası eklemek için:
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d eemessage.example.com
```

---

## 📂 Proje Yapısı

```
eemessage/
├── docker-compose.yml          # Docker servisleri
├── Dockerfile.client           # Frontend build (Vite + Nginx)
├── Dockerfile.server           # Backend build (Node.js)
├── index.html                  # Ana HTML + polyfills
├── package.json                # Frontend bağımlılıkları
├── vite.config.js              # Vite yapılandırması
│
├── server/
│   ├── index.js                # Express + Socket.IO sunucusu
│   └── package.json            # Backend bağımlılıkları
│
├── src/
│   ├── App.jsx                 # Ana uygulama bileşeni
│   ├── config.js               # API URL yapılandırması
│   ├── index.css               # Global stiller + tema
│   ├── main.jsx                # React giriş noktası
│   │
│   └── components/
│       ├── Auth.jsx            # Giriş / Kayıt ekranı
│       ├── CallManager.jsx     # WebRTC arama yönetimi
│       ├── ChatArea.jsx        # Sohbet ekranı + mesajlar
│       ├── NewChatModal.jsx    # Yeni sohbet modalı
│       ├── ProfileModal.jsx    # Profil düzenleme modalı
│       └── Sidebar.jsx         # Kişi listesi + arama
│
└── public/                     # PWA ikonları ve manifest
```

---

## 🔄 Güncelleme

```bash
cd /opt/eemessage
git pull origin main
docker-compose up --build -d
```

---

## 💾 Veri Yedekleme

Veriler Docker volume'unda saklanır:

```bash
# Veritabanı ve uploads'ı yedekle
docker cp eemessage-api:/app/server/database.sqlite ./backup_database.sqlite
docker cp eemessage-api:/app/server/uploads ./backup_uploads

# Geri yükle
docker cp ./backup_database.sqlite eemessage-api:/app/server/database.sqlite
docker cp ./backup_uploads/. eemessage-api:/app/server/uploads/
```

---

## ⚠️ Sorun Giderme

| Sorun | Çözüm |
|-------|-------|
| Resimler yüklenmiyor | `docker logs eemessage-api` ile hata kontrol edin |
| WebRTC bağlanamıyor | Firewall'da 3010 portunun açık olduğundan emin olun |
| Konteyner başlamıyor | `docker-compose down && docker-compose up --build -d` |
| Veritabanı sıfırlama | `docker volume rm eemessage_eemessage_data` |

---

## 📄 Lisans

Bu proje özel kullanım içindir.

---

<p align="center">
  <strong>EEMessage</strong> ile güvenli ve hızlı iletişim 🚀
</p>
