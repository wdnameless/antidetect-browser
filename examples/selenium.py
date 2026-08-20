# Example: drive a profile with Selenium via the AdsPower-compatible Local API.
# Usage: API_KEY=<key> python examples/selenium.py <profileId>
# Requires: pip install selenium  (chromedriver is bundled with the app and returned in data.webdriver)
import os
import sys
import json
import urllib.request

API = os.environ.get("API_BASE", "http://127.0.0.1:50325")
API_KEY = os.environ.get("API_KEY", "")

if len(sys.argv) < 2:
    print("usage: API_KEY=<key> python examples/selenium.py <profileId>")
    sys.exit(1)
profile_id = sys.argv[1]

req = urllib.request.Request(
    f"{API}/api/v1/browser/start?user_id={profile_id}",
    headers={"Authorization": f"Bearer {API_KEY}"},
)
with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read().decode("utf8"))

if data["code"] != 0:
    print("start failed:", data["msg"])
    sys.exit(1)

ws = data["data"]["ws"]
webdriver_path = data["data"].get("webdriver", "")
print("CDP (puppeteer):", ws["puppeteer"])
print("debuggerAddress (selenium):", ws["selenium"])
print("chromedriver:", webdriver_path or "(not bundled)")

# Selenium connection via debuggerAddress:
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service

opts = Options()
opts.add_experimental_option("debuggerAddress", ws["selenium"])
svc = Service(executable_path=webdriver_path) if webdriver_path else None
driver = webdriver.Chrome(service=svc, options=opts)
driver.get("https://whoer.net")
print("title:", driver.title)
