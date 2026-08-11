# Example: drive a profile with Selenium via the AdsPower-compatible Local API.
# Usage: API_KEY=<key> python examples/selenium.py <profileId>
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
print("CDP (puppeteer):", ws["puppeteer"])
print("debuggerAddress (selenium):", ws["selenium"])

# Selenium connection (requires selenium + a matching chromedriver):
#   from selenium import webdriver
#   from selenium.webdriver.chrome.options import Options
#   opts = Options()
#   opts.add_experimental_option("debuggerAddress", ws["selenium"])
#   driver = webdriver.Chrome(options=opts)  # supply matching chromedriver
#   driver.get("https://whoer.net")
#   print(driver.title)
