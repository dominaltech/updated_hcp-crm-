========================================================================
                     HOTEL CITY PARK - CRM RELEASE                      
========================================================================

HOW TO RUN:

OPTION A (RECOMMENDED - NATIVE ELECTRON DESKTOP APP):
1. Double-click "Hotel City Park CRM (Electron).lnk" OR "START_ELECTRON_CRM.bat"
   (or launch directly from: release-electron\Hotel City Park CRM-win32-x64\Hotel City Park CRM.exe)
2. Opens immediately inside a native, maximized desktop window with instant splash screen.

OPTION B (BROWSER LAUNCHER):
1. Double-click "HotelCityPark.exe"
2. Launches server and opens your default browser to http://localhost:3000/hospitality

DATA STORAGE (WINDOWS APPDATA):
- All hotel data (bookings, guests, IDs, webcam photos, bills, food orders) 
  is stored securely in Windows AppData:
  %APPDATA%\HotelCityPark\hotel_city_park.db
  (Full Path: C:\Users\<Username>\AppData\Roaming\HotelCityPark\hotel_city_park.db)
- Your data is completely safe from accidental deletion and survives app updates!

KEYBOARD SHORTCUTS IN ELECTRON APP:
- Ctrl+P: Print Document / Folio / Invoice
- Ctrl+R: Refresh Screen
- F11: Full Screen Toggle
- File > Open AppData Database Folder: Opens sqlite data directory in Explorer

HOW TO STOP:
- Simply close the Hotel City Park CRM desktop window.
- Alternatively, double-click "Stop_HotelCityPark.bat" anytime.

SYSTEM REQUIREMENTS:
- Windows 10 or Windows 11 (64-bit)
- No Node.js installation needed (bundled portable runtime included).

========================================================================
HOTEL CITY PARK CRM - READY FOR DEPLOYMENT
========================================================================
