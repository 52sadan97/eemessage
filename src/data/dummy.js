export const currentUser = {
  id: 1,
  name: "Ertuğrul",
  avatar: "https://i.pravatar.cc/150?u=ertugrul",
};

export const contacts = [
  {
    id: 101,
    name: "Ahmet Yılmaz",
    avatar: "https://i.pravatar.cc/150?u=ahmet",
    lastMessage: "Yarın görüşürüz!",
    time: "10:45",
    unread: 2,
    online: true,
  },
  {
    id: 102,
    name: "Ayşe Kaya",
    avatar: "https://i.pravatar.cc/150?u=ayse",
    lastMessage: "Sunumu hazırladım, kontrol eder misin?",
    time: "Dün",
    unread: 0,
    online: false,
  },
  {
    id: 103,
    name: "Mehmet Demir",
    avatar: "https://i.pravatar.cc/150?u=mehmet",
    lastMessage: "Tamamdır, anlaştık.",
    time: "Pzt",
    unread: 0,
    online: true,
  },
  {
    id: 104,
    name: "Design Team",
    avatar: "https://i.pravatar.cc/150?u=design",
    lastMessage: "Yeni logolar harika olmuş 🔥",
    time: "Cum",
    unread: 0,
    online: false,
  }
];

export const messagesData = {
  101: [
    { id: 1, text: "Selam Ahmet, nasılsın?", senderId: 1, timestamp: "10:30" },
    { id: 2, text: "İyidir Ertuğrul, sen nasılsın?", senderId: 101, timestamp: "10:35" },
    { id: 3, text: "Ben de iyiyim, yarınki toplantı saat kaçtaydı?", senderId: 1, timestamp: "10:36" },
    { id: 4, text: "Sabah 10'da diye konuştuk.", senderId: 101, timestamp: "10:40" },
    { id: 5, text: "Tamam, yarın görüşürüz!", senderId: 101, timestamp: "10:45" },
  ],
  102: [
    { id: 1, text: "Ayşe selam, sunum bitti mi?", senderId: 1, timestamp: "09:00" },
    { id: 2, text: "Evet, sunumu hazırladım, kontrol eder misin?", senderId: 102, timestamp: "09:15" },
  ],
  103: [
    { id: 1, text: "Mehmet abi naber?", senderId: 1, timestamp: "14:20" },
    { id: 2, text: "İyidir kardeşim, yarınki işi hallediyoruz.", senderId: 103, timestamp: "14:25" },
    { id: 3, text: "Tamamdır, anlaştık.", senderId: 103, timestamp: "14:26" },
  ],
  104: [
    { id: 1, text: "Arkadaşlar logoları yükledim.", senderId: 101, timestamp: "11:00" },
    { id: 2, text: "Yeni logolar harika olmuş 🔥", senderId: 104, timestamp: "11:05" },
  ]
};
