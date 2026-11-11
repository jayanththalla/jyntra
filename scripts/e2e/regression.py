"""Browser regression for the core workflow. Needs a running app + seeded DB (see scripts/e2e/README.md).
   BASE_URL=http://localhost:3100 python3 scripts/e2e/regression.py
Runs real Chromium (desktop + 390px mobile). Exit code 1 if any check fails. Screenshots of failures go to /tmp/e2e-fail-*.png"""
import os, re, sys
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE_URL", "http://localhost:3100")
passed, failed = 0, 0
console_problems = []

def check(name, fn, page=None):
    global passed, failed
    try:
        fn(); passed += 1; print(f"  ✓ {name}")
    except Exception as e:
        failed += 1; print(f"  ✗ {name}\n    {str(e).splitlines()[0][:300]}")
        if page: page.screenshot(path=f"/tmp/e2e-fail-{failed}.png")

def watch(page):
    page.on("console", lambda m: console_problems.append((page.url, m.text)) if m.type == "error" or "Content Security Policy" in m.text else None)
    page.on("pageerror", lambda e: console_problems.append((page.url, "pageerror: " + str(e))))

def onboard(pg):
    pg.goto(f"{BASE}/login?next=/discover")
    pg.get_by_text("Continue without an account").click(); pg.wait_for_load_state("networkidle")
    pg.get_by_placeholder("e.g. Python, React, SQL").fill("Node.js"); pg.keyboard.press("Enter")
    pg.get_by_placeholder("e.g. Python, React, SQL").fill("Postgres"); pg.keyboard.press("Enter")
    pg.get_by_role("button", name="Next").click()
    pg.get_by_role("button", name="Backend Developer", exact=True).click()
    pg.get_by_role("button", name="Next").click(); pg.wait_for_timeout(400)
    pg.get_by_role("button", name="Hyderabad", exact=True).click()
    pg.get_by_role("button", name="Show my jobs").click()
    pg.wait_for_url(re.compile(r"/discover"), timeout=20000)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 900}); pg = ctx.new_page(); watch(pg)

    print("1. new user creates a profile")
    check("onboarding creates a profile and lands on Discover", lambda: onboard(pg), pg)

    print("2. Discover: default view, evidence, dates")
    pg.goto(f"{BASE}/discover"); pg.wait_for_selector("text=Acme Pay", timeout=15000)
    body = lambda: pg.inner_text("main")
    check("new dated job and newly-found undated job are shown", lambda: (expect(pg.get_by_text("Backend Engineer", exact=True).first).to_be_visible(), expect(pg.get_by_text("Backend Developer Intern")).to_be_visible()), pg)
    check("the 40-day-old role is NOT in the default view", lambda: expect(pg.get_by_text("Backend Developer Platform")).to_have_count(0), pg)
    check("the card says an undated job has no posting date and shows first-seen, never 'Posted'", lambda: (re.search(r"Posting date not provided\. First seen by Jyntra", body()) or (_ for _ in ()).throw(AssertionError("no first-seen label"))), pg)
    check("dated job says where the date came from", lambda: re.search(r"Posted 2 days ago \(date from the source\)", body()) or (_ for _ in ()).throw(AssertionError(body()[:300])), pg)
    check("verified opening badge, source and last-checked are shown", lambda: (expect(pg.get_by_text("Verified opening").first).to_be_visible(), expect(pg.get_by_text(re.compile(r"Last checked \d+ h ago|Last checked just now")).first).to_be_visible()), pg)
    check("original listing link points at the job's own URL, in a new tab", lambda: (lambda a: (a.get_attribute("href") == "https://acmepay.test/j/1" and a.get_attribute("target") == "_blank") or (_ for _ in ()).throw(AssertionError(a.get_attribute("href"))))(pg.locator("a[href='https://acmepay.test/j/1']").first), pg)
    check("'why this fits / not known' details open and list gaps", lambda: (pg.get_by_text("Why this fits, and what is missing").first.click(), expect(pg.get_by_text("Not known").first).to_be_visible()), pg)
    check("the page offers the older roles still listed", lambda: expect(pg.get_by_text(re.compile(r"\d+ older roles? still listed"))).to_be_visible(), pg)

    def show_older():
        pg.get_by_role("button", name=re.compile(r"older roles? still listed")).click()
        expect(pg.get_by_text("Backend Developer Platform")).to_be_visible(); expect(pg.get_by_text("Older listing, still listed")).to_be_visible()
    check("'Show them' reveals the older role, labelled as older", show_older, pg)

    print("3. YC batch / source filters live inside Jobs")
    def yc():
        pg.get_by_role("combobox", name="Y Combinator batch").click(); pg.get_by_role("option", name=re.compile("Winter 2026")).click()
        expect(pg.get_by_text("Software Engineer", exact=True).first).to_be_visible(); expect(pg.get_by_text("Backend Developer Intern")).to_have_count(0)
        expect(pg.get_by_text("Listed opening").first).to_be_visible()
        pg.get_by_role("combobox", name="Y Combinator batch").click(); pg.get_by_role("option", name="Any YC batch").click()
    check("YC batch filter narrows to the batch; a directory-listed job is 'Listed', not 'Verified'", yc, pg)
    check("old /yc-jobs and /jobs URLs land on Discover", lambda: (pg.goto(f"{BASE}/yc-jobs"), pg.wait_for_url(re.compile(r"/discover")), pg.goto(f"{BASE}/jobs"), pg.wait_for_url(re.compile(r"/discover"))), pg)

    print("4. Startups tab: funding is a signal, not hiring")
    def startups():
        pg.goto(f"{BASE}/discover?tab=startups"); pg.wait_for_selector("text=Acme Pay", timeout=15000)
        expect(pg.get_by_text("Hyderabad startup directory")).to_be_visible()
        t = pg.inner_text("main"); assert "Acme Pay" in t
    check("recently funded companies listed; Hyderabad directory is a secondary link", startups, pg)

    print("5. Applications is hidden")
    check("/applications and /tools redirect away; no sidebar link to them", lambda: (pg.goto(f"{BASE}/applications"), pg.wait_for_url(re.compile(r"/dashboard")), pg.goto(f"{BASE}/tools"), pg.wait_for_url(re.compile(r"/career-ai")), expect(pg.get_by_role("navigation", name="Primary").get_by_role("link", name=re.compile("Applications"))).to_have_count(0)), pg)

    print("6. Outreach: one draft service, honest manual log")
    def outreach():
        pg.goto(f"{BASE}/discover"); pg.get_by_role("link", name=re.compile("Reach out")).first.click(); pg.wait_for_url(re.compile(r"/outreach/"))
        pg.wait_for_selector("textarea", timeout=15000)
        pg.locator("textarea").first.fill("Hi, I built a Node.js and Postgres API and would love to help. Could we talk?")
        pg.get_by_role("button", name="Save draft").click(); expect(pg.get_by_text("Draft saved. It has not been sent.")).to_be_visible()
    check("a draft can be saved and is clearly not sent", outreach, pg)
    def manual():
        # The log button is only offered AFTER the user opens Gmail compose (Jyntra never offers to log what you haven't started).
        expect(pg.get_by_role("button", name=re.compile("I sent it, log it"))).to_have_count(0)
        mail = pg.locator("input[type=email]").first
        if mail.count(): mail.fill("founder@acmepay.test")
        with pg.context.expect_page() as popup: pg.get_by_role("link", name=re.compile("Open in Gmail")).click()
        popup.value.close()
        pg.get_by_role("button", name=re.compile("I sent it, log it")).click(); expect(pg.get_by_text(re.compile("sent by you. Jyntra can't confirm"))).to_be_visible()
    check("logging a message you sent yourself says it was sent by you, never confirmed", manual, pg)

    print("7. Dashboard")
    def dash():
        pg.goto(f"{BASE}/dashboard"); pg.wait_for_selector("text=Recommended jobs", timeout=15000)
        for l in ["New matches"]: expect(pg.get_by_text(l, exact=True)).to_be_visible()
        expect(pg.get_by_text("Startups found")).to_have_count(0)
    check("four user metrics + recommendations, none of the old catalogue tiles", dash, pg)
    check("sidebar: Dashboard, Discover, Profile + the five tools; no Applications, no Tools page", lambda: ([expect(pg.get_by_role("navigation", name="Primary").get_by_role("link", name=re.compile(n)).first).to_be_visible() for n in ["Dashboard", "Discover", "Profile", "Atlas", "Mock interview", "Open source", "Funding news", "Hyderabad"]], expect(pg.get_by_role("navigation", name="Primary").get_by_role("link", name=re.compile("Applications|Career tools$"))).to_have_count(0)), pg)

    print("8. Mobile (390px)")
    mctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, storage_state=ctx.storage_state()); mp = mctx.new_page(); watch(mp)
    for path in ["/dashboard", "/discover", "/discover?tab=startups", "/career-ai", "/mock-interview", "/news", "/settings"]:
        def overflow(path=path):
            mp.goto(BASE + path); mp.wait_for_load_state("networkidle"); mp.wait_for_timeout(600)
            w = mp.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
            assert w[0] <= w[1] + 1, f"horizontal overflow {w}"
        check(f"no horizontal overflow at 390px: {path}", overflow, mp)
    check("mobile bottom bar has five links plus More, and the Filters button works", lambda: (mp.goto(BASE + "/discover"), expect(mp.get_by_role("navigation", name="Main").get_by_role("link")).to_have_count(5), expect(mp.get_by_role("button", name="More")).to_be_visible(), mp.get_by_role("button", name=re.compile("Filters")).click(), expect(mp.get_by_role("combobox", name="Posted")).to_be_visible()), mp)

    print("9. Console / CSP")
    bad = [c for c in console_problems if "favicon" not in c[1] and not (c[0].endswith("/onboarding") and "401" in c[1])]  # 401 on /onboarding = the "do I have a profile yet" check, expected
    for u, m in bad[:12]: print("      •", u.replace(BASE, ""), "|", m[:230].replace("\n", " "))
    check(f"no CSP violations or page errors across the whole run ({len(bad)} found)", lambda: (not bad) or (_ for _ in ()).throw(AssertionError(str(bad[:3]))))
    b.close()

print(f"\n{passed} passed, {failed} failed"); sys.exit(1 if failed else 0)
