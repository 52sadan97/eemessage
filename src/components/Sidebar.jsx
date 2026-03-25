import { useState } from 'react';
import { MessageSquare, MoreVertical, Search, Moon, Sun } from 'lucide-react';
import { getMediaUrl } from '../config';
import NewChatModal from './NewChatModal';
import ProfileModal from './ProfileModal';
import './Sidebar.css';

const Sidebar = ({ contacts, selectedContactId, onSelectContact, theme, toggleTheme, currentUser, onUpdateProfile, onLogout }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <img 
          src={getMediaUrl(currentUser.avatar)} 
          alt="User" 
          className="avatar" 
          onClick={() => setIsProfileModalOpen(true)}
          style={{ cursor: 'pointer' }}
          title="Profili Düzenle"
        />
        <div className="sidebar-header-actions">
          <button className="icon-btn glass-btn" onClick={toggleTheme} title="Tema Değiştir">
            {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
          </button>
          <button className="icon-btn" onClick={() => setIsModalOpen(true)} title="Yeni Sohbet"><MessageSquare size={20} /></button>
          <div className="dropdown-container">
            <button className="icon-btn" onClick={() => setIsDropdownOpen(!isDropdownOpen)} title="Menü">
              <MoreVertical size={20} />
            </button>
            {isDropdownOpen && (
              <div className="dropdown-menu">
                <button onClick={() => { setIsDropdownOpen(false); onLogout(); }}>Çıkış Yap</button>
              </div>
            )}
          </div>
        </div>
      </div>
      
      <div className="search-container">
        <div className="search-box">
          <Search size={18} className="search-icon" />
          <input type="text" placeholder="Aratın veya yeni sohbet başlatın" />
        </div>
      </div>

      <div className="contacts-list">
        {contacts.map(contact => (
          <div 
            key={contact.id} 
            className={`contact-item ${selectedContactId === contact.id ? 'active' : ''}`}
            onClick={() => onSelectContact(contact.id)}
          >
            <div className="avatar-wrapper">
              <img src={getMediaUrl(contact.avatar)} alt={contact.name} className="avatar" />
              {contact.online && <span className="online-indicator"></span>}
            </div>
            <div className="contact-info">
              <div className="contact-top">
                <span className="contact-name">{contact.name}</span>
                <span className="contact-time">{contact.time}</span>
              </div>
              <div className="contact-bottom">
                <span className="contact-last-msg">{contact.lastMessage}</span>
                {contact.unread > 0 && (
                  <span className="unread-badge">{contact.unread}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      <NewChatModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onSelectContact={onSelectContact} 
        contacts={contacts}
      />
      <ProfileModal 
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        currentUser={currentUser}
        onSave={onUpdateProfile}
      />
    </div>
  );
};

export default Sidebar;
