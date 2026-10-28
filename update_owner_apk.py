import zipfile
import subprocess
import os
import shutil

apk_path = r"c:\Aamir Delta\city_backup\HotelCityPark-Owner.apk"
bundle_dir = r"c:\Aamir Delta\city_backup\admin\dist-android\_expo\static\js\android"
hbc_files = [os.path.join(bundle_dir, f) for f in os.listdir(bundle_dir) if f.endswith(".hbc")]
if not hbc_files:
    raise FileNotFoundError("No .hbc bundle file found in " + bundle_dir)
hbc_files.sort(key=lambda x: os.path.getmtime(x), reverse=True)
bundle_src = hbc_files[0]
print("Using bundle source:", bundle_src)
temp_apk = r"c:\Aamir Delta\city_backup\temp_owner.apk"
aligned_apk = r"c:\Aamir Delta\city_backup\aligned_owner.apk"

build_tools = r"C:\Users\91937\AppData\Local\Android\Sdk\build-tools\37.0.0"
zipalign = os.path.join(build_tools, "zipalign.exe")
apksigner = os.path.join(build_tools, "apksigner.bat")
keystore = r"C:\Users\91937\.android\debug.keystore"

print("Reading and updating index.android.bundle inside APK...")
with zipfile.ZipFile(apk_path, 'r') as zin:
    with zipfile.ZipFile(temp_apk, 'w', compression=zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            # Skip old bundle and old signatures
            if item.filename == "assets/index.android.bundle":
                continue
            if item.filename.startswith("META-INF/"):
                continue
            buffer = zin.read(item.filename)
            zout.writestr(item, buffer)
        
        # Add updated bundle
        with open(bundle_src, 'rb') as f:
            zout.writestr("assets/index.android.bundle", f.read())

print("Running zipalign...")
if os.path.exists(aligned_apk):
    os.remove(aligned_apk)
subprocess.check_call([zipalign, "-p", "-f", "4", temp_apk, aligned_apk])

print("Signing with debug keystore...")
subprocess.check_call([
    apksigner, "sign",
    "--ks", keystore,
    "--ks-pass", "pass:android",
    "--ks-key-alias", "androiddebugkey",
    "--key-pass", "pass:android",
    aligned_apk
])

print("Verifying...")
subprocess.check_call([apksigner, "verify", "--verbose", aligned_apk])

os.replace(aligned_apk, apk_path)
targets = [
    r"c:\Aamir Delta\city_backup\HotelCityPark-Admin.apk",
    r"c:\Aamir Delta\city_backup\public\HotelCityPark-Admin.apk",
    r"c:\Aamir Delta\city_backup\public\HotelCityPark-Owner.apk",
    r"c:\Aamir Delta\city_backup\public\HotelCityPark-Owner-v2.apk",
    r"c:\Aamir Delta\city_backup\release\public\HotelCityPark-Admin.apk",
    r"c:\Aamir Delta\city_backup\release\public\HotelCityPark-Owner.apk",
    r"c:\Aamir Delta\city_backup\release\public\HotelCityPark-Owner-v2.apk",
    r"c:\Aamir Delta\city_backup\release\dist\HotelCityPark-Owner-v2.apk",
    r"c:\Aamir Delta\city_backup\dist\HotelCityPark-Admin.apk",
    r"c:\Aamir Delta\city_backup\dist\HotelCityPark-Owner.apk",
    r"c:\Aamir Delta\city_backup\dist\HotelCityPark-Owner-v2.apk",
    r"c:\Aamir Delta\city_backup\apks\HotelCityPark-Admin.apk",
    r"c:\Aamir Delta\city_backup\apks\HotelCityPark-Owner.apk"
]
for t in targets:
    try:
        os.makedirs(os.path.dirname(t), exist_ok=True)
        shutil.copyfile(apk_path, t)
        print("Copied to:", t)
    except Exception as e:
        print("Warning copying to", t, e)

if os.path.exists(temp_apk):
    os.remove(temp_apk)

print("SUCCESS: HotelCityPark-Owner.apk updated, signed, and deployed to public!")
