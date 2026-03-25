import { X, Search } from 'lucide-react';
import { getMediaUrl } from '../config';
import './NewChatModal.css';

const NewChatModal = ({ isOpen, onClose, onSelectContact, contacts }) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content glass" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Yeni Sohbet Başlat</h3>
          <button className="icon-btn" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="modal-search">
          <div className="search-box">
            <Search size={18} className="search-icon" />
            <input type="text" placeholder="Kişilerde ara..." />
          </div>
        </div>
        <div className="modal-contacts-list">
          {contacts.map(contact => (
            <div 
              key={contact.id} 
              className="contact-item"
              onClick={() => {
                onSelectContact(contact.id);
                onClose();
              }}
            >
              <div className="avatar-wrapper">
                <img src={getMediaUrl(contact.avatar)} alt={contact.name} className="avatar" />
                {contact.online && <span className="online-indicator"></span>}
              </div>
              <div className="contact-info">
                <div className="contact-top">
                  <span className="contact-name">{contact.name}</span>
                </div>
                <div className="contact-bottom">
                  <span className="contact-last-msg">{contact.online ? "Çevrimiçi" : "Çevrimdışı"}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default NewChatModal;
