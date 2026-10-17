import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import fs from 'fs';
import path from 'path';

describe('UnifiedTimeInput Component Auto-Open Prop and Header Support', () => {
  const componentPath = path.resolve(__dirname, '../src/components/common/UnifiedTimeInput.jsx');
  const code = fs.readFileSync(componentPath, 'utf8');

  it('1. accepts openMenuProp and onMenuOpenChange props', () => {
    expect(code).toContain('openMenuProp = null');
    expect(code).toContain('onMenuOpenChange = null');
  });

  it('2. listens to openMenuProp changes and updates openMenu state', () => {
    expect(code).toContain('const updateOpenMenu = (newVal) => {');
    expect(code).toContain('setOpenMenu(menuType)');
    expect(code).toContain('typeof openMenuProp === \'object\' ? openMenuProp.type : openMenuProp');
  });

  it('3. routes handleSelectHour and handleSelectMinute through updateOpenMenu', () => {
    expect(code).toContain("updateOpenMenu('minute')");
    expect(code).toContain("updateOpenMenu(null)");
  });

  it('4. includes AM/PM toggle directly inside the hour popover header', () => {
    expect(code).toContain("Select Hour (1 - 12)");
    expect(code).toContain("handlePeriodChange('AM')");
    expect(code).toContain("handlePeriodChange('PM')");
  });
});
