import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../server';
import fs from 'fs';
import path from 'path';

describe('Occupancy Chart Button, Modal, API, and Print Layout', () => {
  const rootDir = path.resolve(__dirname, '..');

  it('1. Verifies HospitalityPage.jsx contains "Occupancy Chart" button immediately left of "Advance Booking"', () => {
    const hospContent = fs.readFileSync(path.join(rootDir, 'src/pages/HospitalityPage.jsx'), 'utf-8');
    expect(hospContent).toContain('id="btn-occupancy-chart"');
    expect(hospContent).toContain('Occupancy Chart');
    expect(hospContent).toContain('id="btn-advance-booking"');

    const chartBtnPos = hospContent.indexOf('id="btn-occupancy-chart"');
    const advBtnPos = hospContent.indexOf('id="btn-advance-booking"');
    expect(chartBtnPos).toBeGreaterThan(-1);
    expect(advBtnPos).toBeGreaterThan(-1);
    // Occupancy Chart must be to the left of Advance Booking
    expect(chartBtnPos).toBeLessThan(advBtnPos);

    // Modal import and usage
    expect(hospContent).toContain("import OccupancyChartModal from '../components/hospitality/OccupancyChartModal';");
    expect(hospContent).toContain('<OccupancyChartModal');
  });

  it('2. Verifies public/styles.css defines .btn-occupancy-chart styles', () => {
    const cssContent = fs.readFileSync(path.join(rootDir, 'public/styles.css'), 'utf-8');
    expect(cssContent).toContain('.btn-occupancy-chart');
    expect(cssContent).toContain('[data-theme="dark"] .btn-occupancy-chart');
  });

  it('3. Verifies GET /api/hospitality/occupancy-chart endpoint returns rooms and correct schema', async () => {
    const res = await request(app).get('/api/hospitality/occupancy-chart');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.chart)).toBe(true);
    expect(res.body.chart.length).toBeGreaterThan(0);

    const firstRoom = res.body.chart[0];
    expect(firstRoom).toHaveProperty('room_number');
    expect(firstRoom).toHaveProperty('is_occupied');
    expect(firstRoom).toHaveProperty('breakfast');
    expect(firstRoom).toHaveProperty('city');
    expect(firstRoom).toHaveProperty('pax');

    expect(res.body.summary).toBeDefined();
    expect(res.body.summary.totalRooms).toBe(res.body.chart.length);
    expect(res.body.summary.occupiedCount).toBeGreaterThanOrEqual(0);
    expect(res.body.summary.vacantCount).toBeGreaterThanOrEqual(0);
    expect(res.body.summary.totalPax).toBeGreaterThanOrEqual(0);
    expect(res.body.summary).toHaveProperty('totalBreakfastPax');
    expect(res.body.summary).toHaveProperty('totalBreakfastRooms');
  });

  it('4. Verifies Breakfast logic: with breakfast -> Yes, without -> No', async () => {
    const res = await request(app).get('/api/hospitality/occupancy-chart');
    expect(res.status).toBe(200);
    const occupied = res.body.chart.filter(r => r.is_occupied);
    if (occupied.length > 0) {
      occupied.forEach(r => {
        expect(['Yes', 'No']).toContain(r.breakfast);
      });
    }
  });

  it('5. Verifies OccupancyChartModal.jsx contains dotted line separator in Arr/Dep column and matching print format', () => {
    const modalContent = fs.readFileSync(path.join(rootDir, 'src/components/hospitality/OccupancyChartModal.jsx'), 'utf-8');
    
    // Check Breakfast column exists right after City in the print <thead>
    const theadMatch = modalContent.match(/<thead>([\s\S]*?)<\/thead>/);
    expect(theadMatch).not.toBeNull();
    const theadStr = theadMatch[1];

    const cityIdx = theadStr.indexOf('City');
    const breakfastIdx = theadStr.indexOf('Breakfast');
    const paxIdx = theadStr.indexOf('Pax');
    expect(cityIdx).toBeGreaterThan(-1);
    expect(breakfastIdx).toBeGreaterThan(-1);
    expect(paxIdx).toBeGreaterThan(-1);
    expect(cityIdx).toBeLessThan(breakfastIdx);
    expect(breakfastIdx).toBeLessThan(paxIdx);

    // Dotted line separator in Arr/Dep
    expect(modalContent).toContain('border-top: 1.2px dotted #000');
    expect(modalContent).toContain('dotted-sep');

    // Reference document titles in print template
    expect(modalContent).toContain('HOTEL CITY PARK');
    expect(modalContent).toContain('ROOM OCCUPANCY CHART');
    expect(modalContent).toContain('ROOM OCCUPANCY :');
    expect(modalContent).toContain('TOTAL BREAKFAST :');
    expect(modalContent).toContain('TOTAL PAX :');
  });
});
