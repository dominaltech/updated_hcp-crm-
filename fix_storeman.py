import os
import sys
import zipfile
import subprocess
import shutil

# Detect Android SDK build-tools
SDK_ROOT = r"C:\Users\91937\AppData\Local\Android\Sdk\build-tools"
for v in ["37.0.0", "36.0.0", "35.0.0", "34.0.0"]:
    candidate = os.path.join(SDK_ROOT, v)
    if os.path.exists(candidate):
        SDK_BUILD_TOOLS = candidate
        break
else:
    SDK_BUILD_TOOLS = os.path.join(SDK_ROOT, "35.0.0")

ZIPALIGN = os.path.join(SDK_BUILD_TOOLS, "zipalign.exe")
APKSIGNER = os.path.join(SDK_BUILD_TOOLS, "apksigner.bat")
KEYSTORE = r"C:\Users\91937\.android\debug.keystore"

WORKSPACE = r"C:\Aamir Delta\city_backup"
SRC_APK = os.path.join(WORKSPACE, "Storeman.apk")
SRC_HTML = os.path.join(WORKSPACE, "store_index.html")

CLEAN_APK = os.path.join(WORKSPACE, "temp_Storeman_clean.apk")
ALIGNED_APK = os.path.join(WORKSPACE, "temp_Storeman_aligned.apk")

DESTINATIONS = [
    os.path.join(WORKSPACE, "Storeman.apk"),
    os.path.join(WORKSPACE, "public", "Storeman.apk"),
    os.path.join(WORKSPACE, "dist", "Storeman.apk")
]

print(f"Using build-tools: {SDK_BUILD_TOOLS}")
print("=== STEP 1: Reading APK and stripping old signatures & updating index.html ===")
with zipfile.ZipFile(SRC_APK, 'r') as zin, zipfile.ZipFile(CLEAN_APK, 'w', compression=zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        name = item.filename
        # Strip all previous signature files
        if name.startswith("META-INF/") and (
            name.endswith(".SF") or 
            name.endswith(".RSA") or 
            name.endswith(".DSA") or 
            name.endswith(".EC") or 
            name == "META-INF/MANIFEST.MF"
        ):
            print(f"  Stripping: {name}")
            continue
        
        # Inject latest store_index.html
        if name == "assets/flutter_assets/assets/store/index.html":
            print(f"  Updating: {name} from {SRC_HTML}")
            with open(SRC_HTML, 'rb') as hf:
                content = hf.read()
            zout.writestr(item, content)
        else:
            buffer = zin.read(item.filename)
            zout.writestr(item, buffer)

print(f"Wrote clean APK: {CLEAN_APK} ({os.path.getsize(CLEAN_APK)} bytes)")

print("\n=== STEP 2: Running zipalign -p -f 4 ===")
if os.path.exists(ALIGNED_APK):
    os.remove(ALIGNED_APK)

res_align = subprocess.run([ZIPALIGN, "-p", "-f", "4", CLEAN_APK, ALIGNED_APK], capture_output=True, text=True)
if res_align.returncode != 0:
    print(f"ERROR: Zipalign failed: {res_align.stderr}")
    sys.exit(1)

# Verify alignment
res_v_align = subprocess.run([ZIPALIGN, "-c", "-v", "4", ALIGNED_APK], capture_output=True, text=True)
if "verification success" not in res_v_align.stdout.lower():
    print("ERROR: Zipalign verification failed!")
    print(res_v_align.stdout[-500:])
    sys.exit(1)
print("Zipalign verification: SUCCESSFUL (4-byte and 4KB page aligned)!")

print("\n=== STEP 3: Signing with apksigner (v1, v2, v3) ===")
cmd_sign = f'"{APKSIGNER}" sign -v --ks "{KEYSTORE}" --ks-pass pass:android --ks-key-alias androiddebugkey --key-pass pass:android --min-sdk-version 21 --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true "{ALIGNED_APK}"'
res_sign = subprocess.run(cmd_sign, shell=True, capture_output=True, text=True)
print("Apksigner output:", res_sign.stdout, res_sign.stderr)
if res_sign.returncode != 0:
    print(f"ERROR: Apksigner failed with code {res_sign.returncode}")
    sys.exit(1)

print("\n=== STEP 4: Verifying signature ===")
cmd_verify = f'"{APKSIGNER}" verify --verbose --min-sdk-version 23 "{ALIGNED_APK}"'
res_verify = subprocess.run(cmd_verify, shell=True, capture_output=True, text=True)
print("Verification summary:")
for line in res_verify.stdout.splitlines()[:10]:
    print(" ", line)

if "Verifies" not in res_verify.stdout:
    print("ERROR: Signature verification failed!")
    sys.exit(1)

print("\n=== STEP 5: Deploying aligned & signed APK to destinations ===")
for dst in DESTINATIONS:
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(ALIGNED_APK, dst)
    print(f"  Deployed -> {dst} ({os.path.getsize(dst)} bytes)")

print("\n=== STEP 6: Cleaning temp files ===")
for tmp in [CLEAN_APK, ALIGNED_APK, os.path.join(WORKSPACE, "Storeman_clean.apk"), os.path.join(WORKSPACE, "Storeman_aligned.apk"), os.path.join(WORKSPACE, "Storeman_aligned_final.apk")]:
    if os.path.exists(tmp):
        try:
            os.remove(tmp)
            print(f"  Removed temporary: {os.path.basename(tmp)}")
        except Exception as e:
            print(f"  Could not remove {tmp}: {e}")

print("\n[SUCCESS] Storeman.apk successfully rebuilt, aligned, signed, and deployed!")
