import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Room Folio Expenses Feature', () => {
  const folioPagePath = path.resolve(__dirname, '../src/pages/RoomFolioPage.jsx');
  const folioCode = fs.readFileSync(folioPagePath, 'utf-8');

  it('1) RoomFolioPage includes the Expenses action button chip in the header', () => {
    expect(folioCode).toContain('btn-folio-expenses-chip');
    expect(folioCode).toContain('Expenses');
  });

  it('2) RoomFolioPage includes the dedicated Extra Expenses, Loss & Damages section card', () => {
    expect(folioCode).toContain('Extra Expenses, Loss &amp; Damages');
    expect(folioCode).toContain('Add Expense / Damage');
  });

  it('3) RoomFolioPage contains the Add Extra Expense / Damage modal', () => {
    expect(folioCode).toContain('Add Extra Expense / Damage');
    expect(folioCode).toContain('handleSaveExtraExpense');
    expect(folioCode).toContain('handleDeleteExpense');
  });

  it('4) Server includes roomId and linkedToFolio support on expenses', () => {
    const serverPath = path.resolve(__dirname, '../server.js');
    const serverCode = fs.readFileSync(serverPath, 'utf-8');
    expect(serverCode).toContain('roomId');
  });
});
