import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Room Folio Full Screen Scroll Fix', () => {
  const rootDir = path.resolve(__dirname, '..');

  it('1. MainLayout.jsx accepts hasActiveFolio and only applies overflow hidden when on rooms grid', () => {
    const mainLayoutCode = fs.readFileSync(path.join(rootDir, 'src/layouts/MainLayout.jsx'), 'utf8');
    expect(mainLayoutCode).toContain('hasActiveFolio');
    expect(mainLayoutCode).toContain('const isHospitalityGrid = activePanel === \'hospitality\' && !hasActiveFolio;');
    expect(mainLayoutCode).toContain('${isHospitalityGrid ? \'hospitality-container\' : \'\'}');
  });

  it('2. App.jsx passes hasActiveFolio to MainLayout', () => {
    const appCode = fs.readFileSync(path.join(rootDir, 'src/App.jsx'), 'utf8');
    expect(appCode).toContain('<MainLayout hasActiveFolio={Boolean(activeFolioRoom)}>');
  });

  it('3. public/styles.css and release/public/styles.css allow #view-room-folio to scroll smoothly', () => {
    const cssFiles = [
      path.join(rootDir, 'public/styles.css'),
      path.join(rootDir, 'release/public/styles.css')
    ];

    cssFiles.forEach((file) => {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).toContain('.app-container:has(#view-room-folio)');
      expect(content).toContain('height: auto !important;');
      expect(content).toContain('max-height: none !important;');
      expect(content).toContain('#view-room-folio {');
      expect(content).toContain('padding-bottom: 80px;');
    });
  });
});
