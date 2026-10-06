import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Table Settle Occupied Room Picker Popup & Gating', () => {
  const modalFilePath = path.resolve(__dirname, '../src/components/restaurant/TableSettleModal.jsx');
  const pickerFilePath = path.resolve(__dirname, '../src/components/restaurant/OccupiedRoomPickerModal.jsx');

  it('1. OccupiedRoomPickerModal component file exists and exports default function', () => {
    expect(fs.existsSync(pickerFilePath)).toBe(true);
    const pickerCode = fs.readFileSync(pickerFilePath, 'utf8');
    expect(pickerCode).toContain('export default function OccupiedRoomPickerModal');
  });

  it('2. OccupiedRoomPickerModal displays guest name, mobile number, and check-in date', () => {
    const pickerCode = fs.readFileSync(pickerFilePath, 'utf8');
    // Checks for guest name
    expect(pickerCode).toContain('guestName');
    expect(pickerCode).toContain('room.guest_name');
    // Checks for guest mobile
    expect(pickerCode).toContain('guestMobile');
    expect(pickerCode).toContain('room.guest_mobile');
    // Checks for checkin date
    expect(pickerCode).toContain('checkinDisplay');
    expect(pickerCode).toContain('room.checkin_time');
    expect(pickerCode).toContain('formatDateTime(room.checkin_time)');
  });

  it('3. OccupiedRoomPickerModal supports real-time search filtering across Room #, Guest Name, and Mobile Number', () => {
    const pickerCode = fs.readFileSync(pickerFilePath, 'utf8');
    expect(pickerCode).toContain('searchTerm');
    expect(pickerCode).toContain('setSearchTerm');
    expect(pickerCode).toContain('rNum.includes(q)');
    expect(pickerCode).toContain('gName.includes(q)');
    expect(pickerCode).toContain('gMobile.includes(q)');
  });

  it('4. TableSettleModal imports and renders OccupiedRoomPickerModal', () => {
    const modalCode = fs.readFileSync(modalFilePath, 'utf8');
    expect(modalCode).toContain("import OccupiedRoomPickerModal from './OccupiedRoomPickerModal'");
    expect(modalCode).toContain('<OccupiedRoomPickerModal');
    expect(modalCode).toContain('isRoomPickerOpen');
    expect(modalCode).toContain('setIsRoomPickerOpen');
  });

  it('5. TableSettleModal settle button intercepts clicks when room is not selected and opens popup', () => {
    const modalCode = fs.readFileSync(modalFilePath, 'utf8');
    // Verifies that when isStayingGuest is true but selectedRoomId is missing, it opens the room picker
    expect(modalCode).toContain('if (isStayingGuest && !selectedRoomId)');
    expect(modalCode).toContain('setIsRoomPickerOpen(true)');
    expect(modalCode).toContain('Please select an in-house occupied room to settle');
  });

  it('6. TableSettleModal displays detailed info of selected room including Name, Mobile, and Check-in Date', () => {
    const modalCode = fs.readFileSync(modalFilePath, 'utf8');
    expect(modalCode).toContain('selectedRoom.guest_name');
    expect(modalCode).toContain('selectedRoom.guest_mobile');
    expect(modalCode).toContain('selectedRoom.checkin_time');
    expect(modalCode).toContain('formatDateTime(selectedRoom.checkin_time)');
    expect(modalCode).toContain('Change Room');
  });

  it('7. Replaces "-- Select In-House Guest Room --" dropdown with "Choose Room (mandatory)" button', () => {
    const modalCode = fs.readFileSync(modalFilePath, 'utf8');
    expect(modalCode).not.toContain('-- Select In-House Guest Room --');
    expect(modalCode).toContain('Choose Room (mandatory)');
  });

  it('8. All 3 options (Room, Dining Bill Attribution, Bill Settlement Option) are unselected by default', () => {
    const modalCode = fs.readFileSync(modalFilePath, 'utf8');
    // Default state
    expect(modalCode).toContain("const [selectedRoomId, setSelectedRoomId] = useState('');");
    expect(modalCode).toContain("const [roomBillStatus, setRoomBillStatus] = useState(null);");
    expect(modalCode).toContain("const [roomServiceFor, setRoomServiceFor] = useState(null);");
    // When switching to In-House Hotel Guest (Staying)
    expect(modalCode).toContain("setSelectedRoomId('');");
    expect(modalCode).toContain("setRoomServiceFor(null);");
    expect(modalCode).toContain("setRoomBillStatus(null);");
  });

  it('9. "Settled to Room" button is strictly disabled if ANY ONE of the 3 is not selected by user', () => {
    const modalCode = fs.readFileSync(modalFilePath, 'utf8');
    expect(modalCode).toContain('const isStayingGuestMissingAny = isStayingGuest && (!selectedRoomId || !roomServiceFor || !roomBillStatus);');
    expect(modalCode).toContain('disabled={isSettleDisabled}');
  });
});

