import React from 'react';
import { useApp } from '../../context/AppContext';

/**
 * StaffLittleBadge
 * Compact, modern little badge with icon for Hospitality, Restaurant, and Bar.
 * Replaces bulky capsule/pill buttons with a clean, unobtrusive badge.
 * 
 * @param {'hospitality' | 'restaurant' | 'bar' | 'manager'} section - Department
 * @param {string} id - Button element id
 * @param {string} className - Optional additional CSS classes
 * @param {object} style - Optional style overrides
 */
export default function StaffLittleBadge({ section = 'hospitality', id, className = '', style = {} }) {
  const {
    getDepartmentStaff,
    openStaffLogin,
    openCashierLogout,
    currentUser
  } = useApp();

  const sectionStaff = getDepartmentStaff ? getDepartmentStaff(section) : currentUser;
  const isActive = Boolean(sectionStaff);

  const sectionMeta = {
    hospitality: {
      icon: '🏨',
      name: 'Front Desk',
      themeClass: 'hospitality'
    },
    restaurant: {
      icon: '🍽️',
      name: 'Restaurant',
      themeClass: 'restaurant'
    },
    bar: {
      icon: '🍸',
      name: 'Bar Lounge',
      themeClass: 'bar'
    },
    manager: {
      icon: '⚙️',
      name: 'Management',
      themeClass: 'manager'
    }
  };

  const meta = sectionMeta[section] || sectionMeta.hospitality;

  const displayName = sectionStaff
    ? (sectionStaff.full_name ? sectionStaff.full_name.split(' ')[0] : sectionStaff.username)
    : 'Shift';

  const tooltip = sectionStaff
    ? `${meta.name}: ${sectionStaff.full_name || sectionStaff.username} (${sectionStaff.role}) • Click to switch cashier or end shift`
    : `Click to start ${meta.name} shift`;

  const handleClick = () => {
    if (isActive) {
      openCashierLogout(section);
    } else {
      openStaffLogin(section);
    }
  };

  return (
    <button
      type="button"
      id={id}
      className={`staff-little-badge ${meta.themeClass} ${isActive ? 'active' : 'inactive'} ${className}`.trim()}
      onClick={handleClick}
      title={tooltip}
      style={style}
    >
      <span className="badge-icon" aria-hidden="true">{meta.icon}</span>
      <span className="badge-name">{displayName}</span>
      <span className={`badge-dot ${isActive ? 'online' : 'offline'}`} />
    </button>
  );
}
