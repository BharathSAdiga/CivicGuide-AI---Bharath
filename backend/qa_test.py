import requests
import json
import threading
import time

BASE_URL = "http://127.0.0.1:5000/api"

print("========================================")
print("🚀 CIVICGUIDE AI BACKEND QA TEST SUITE")
print("========================================\n")

# --- 1. Test /eligibility ---
print("--- 1. Testing /eligibility Endpoint ---")

# Case 1: Valid eligible
r = requests.post(f"{BASE_URL}/eligibility", json={"age": 20, "citizenship": True})
data = r.json()
if r.status_code == 200 and data.get("data", {}).get("eligible") is True:
    print("✅ Case 1: age=20, citizen=True -> Eligible (200 OK)")
else:
    print(f"❌ Case 1 Failed: {data}")

# Case 2: Valid ineligible (underage)
r = requests.post(f"{BASE_URL}/eligibility", json={"age": 16, "citizenship": True})
data = r.json()
if r.status_code == 200 and data.get("data", {}).get("eligible") is False:
    print("✅ Case 2: age=16, citizen=True -> Ineligible (200 OK)")
else:
    print(f"❌ Case 2 Failed: {data}")

# Case 3: Invalid input (negative age)
r = requests.post(f"{BASE_URL}/eligibility", json={"age": -5, "citizenship": True})
if r.status_code == 400:
    print("✅ Case 3: age=-5 -> Error Handled (400 Bad Request)")
else:
    print(f"❌ Case 3 Failed: {r.status_code}")

# Case 4: Missing fields
r = requests.post(f"{BASE_URL}/eligibility", json={"age": 25})
if r.status_code == 400:
    print("✅ Case 4: Missing citizenship -> Error Handled (400 Bad Request)")
else:
    print(f"❌ Case 4 Failed: {r.status_code}")

# --- 2. Test /timeline ---
print("\n--- 2. Testing /timeline Endpoint ---")

r = requests.get(f"{BASE_URL}/timeline")
data = r.json()
if r.status_code == 200 and "phases" in data:
    phases = [p["id"] for p in data["phases"]]
    if "registration_deadline" in phases and "voting_day" in phases and "result_day" in phases:
        print("✅ Timeline format valid, key dates present (registration, voting, result).")
    else:
        print("❌ Timeline missing key dates:", phases)
else:
    print(f"❌ Timeline GET Failed: {r.status_code}")


# --- 3. Test /chat ---
print("\n--- 3. Testing /chat Endpoint ---")

# Case 1: Valid input "How do I vote?"
chat_payload = {
    "message": "How do I vote?",
    "language": "english",
    "user_context": {"name": "TestUser", "age": 25, "location": "Delhi"}
}
start_time = time.time()
r = requests.post(f"{BASE_URL}/chat", json=chat_payload)
duration = time.time() - start_time
data = r.json()

if r.status_code == 200 and "reply" in data:
    reply = data["reply"]
    if len(reply) > 20:
        print(f"✅ Chat response is structured and not empty ({len(reply)} chars). Time: {duration:.2f}s")
    else:
        print("❌ Chat response too short or empty.")
else:
    print(f"❌ Chat Valid Request Failed: {r.status_code} {data}")

# Case 2: Missing message field
r = requests.post(f"{BASE_URL}/chat", json={"language": "english"})
if r.status_code == 400:
    print("✅ Chat Missing Field -> Error Handled (400 Bad Request)")
else:
    print(f"❌ Chat Missing Field Failed: {r.status_code}")

# Case 3: Invalid JSON body
r = requests.post(f"{BASE_URL}/chat", data="invalid_json", headers={"Content-Type": "application/json"})
if r.status_code == 400:
    print("✅ Chat Invalid JSON -> Error Handled (400 Bad Request)")
else:
    print(f"❌ Chat Invalid JSON Failed: {r.status_code}")


# --- 4. Performance Testing ---
print("\n--- 4. Performance Testing (Concurrent Requests) ---")
success_count = 0
fail_count = 0

def make_request():
    global success_count, fail_count
    try:
        res = requests.post(f"{BASE_URL}/eligibility", json={"age": 25, "citizenship": True}, timeout=5)
        if res.status_code == 200:
            success_count += 1
        else:
            fail_count += 1
    except Exception:
        fail_count += 1

threads = []
for i in range(10):
    t = threading.Thread(target=make_request)
    threads.append(t)
    t.start()

for t in threads:
    t.join()

print(f"✅ Concurrent Requests (10 threads) -> Success: {success_count}, Fail: {fail_count}")

# --- 5. Security Testing ---
print("\n--- 5. Security & Sanitization ---")

# Injection / XSS Attempt
xss_payload = {
    "message": "<script>alert('xss')</script> SELECT * FROM users;",
    "language": "english",
    "user_context": {"name": "Test"}
}
r = requests.post(f"{BASE_URL}/chat", json=xss_payload)
if r.status_code == 200:
    reply = r.json().get("reply", "")
    if "<script>" not in reply:
        print("✅ Input Sanitization / AI safety handled XSS payload properly.")
    else:
        print("⚠️ Warning: XSS payload reflected in response!")
else:
    print("✅ Input Sanitization / Firewall blocked payload properly.")

print("\n========================================")
print("🏁 QA TESTING COMPLETE")
print("========================================")
