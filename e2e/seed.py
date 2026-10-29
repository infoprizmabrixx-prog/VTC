import requests, sys, uuid
import os
B = os.environ.get("VTC_URL", "http://127.0.0.1:8774") + "/api/v1"
def sess(user=None, pw=None, pin=None, name=None):
    s = requests.Session(); s.headers["X-VTC"] = "1"
    if pin:
        p = [x for x in s.get(B + "/login/pin-people").json() if x["full_name"] == name][0]
        r = s.post(B + "/login/pin", json={"user_id": p["id"], "pin": pin})
    else:
        r = s.post(B + "/login", json={"username": user, "password": pw})
    assert r.ok, r.text
    return s
def call(s, m, path, body=None, key=False):
    h = {"X-Idempotency-Key": str(uuid.uuid4())} if key else {}
    r = s.request(m, B + path, json=body, headers=h)
    if not r.ok: print("FAIL", m, path, r.status_code, r.text); sys.exit(1)
    return r.json()
own = sess("owner", "VTC-Owner-Demo26")
man = sess("manager", "VTC-Manager-Demo26")
ro = sess(pin="2580", name="Demo Roaster")
pk = sess(pin="1470", name="Demo Packer")
rob = call(own, "POST", "/masters", {"kind": "product", "name": "Robusta Cherry AB (sample)", "nominal_kg": 50, "category": "GREEN_COFFEE"})["id"]
ara = call(own, "POST", "/masters", {"kind": "product", "name": "Arabica Plantation A (sample)", "nominal_kg": 50, "category": "GREEN_COFFEE"})["id"]
chi = call(own, "POST", "/masters", {"kind": "product", "name": "Chicory granules (sample)", "nominal_kg": 25, "category": "CHICORY"})["id"]
cafe = call(own, "POST", "/masters", {"kind": "customer", "name": "Sample Café", "phone": "90000 00001"})["id"]
call(own, "POST", "/masters", {"kind": "supplier", "name": "Sample Auction House"})
call(man, "POST", "/masters", {"kind": "customer", "name": "Manager's draft client"})
for n, note in [("City+ (sample)", "205°C drop, 16 min"), ("Medium filter (sample)", "212°C drop"), ("Dark South Indian (sample)", "")]:
    call(own, "POST", "/roast-profiles", {"name": n, "notes": note})
call(own, "PUT", "/admin/settings", {"counter_opening_float_paise": 200000, "discount_cap_pct": 5, "refund_manager_cap_paise": 50000,
    "correction_manager_cap_kg": 2, "custom_coffee_rate_paise": 90000, "custom_chicory_rate_paise": 30000, "custom_chicory_product_id": chi})
call(own, "POST", "/counter/items", {"name": "Filter coffee 70/30", "kind": "coffee_ground", "coffee_pct": 70, "chicory_product_id": chi, "price_per_kg_paise": 72000})
r = call(ro, "POST", "/inward", {"source": "AUCTION", "source_name": "Sample Auction House", "product_id": rob, "bags": 12, "damaged": 1, "partial": 2, "partial_kg": 61.5}, True)

call(ro, "POST", "/inward", {"source": "AUCTION", "source_name": "Sample Auction House", "product_id": ara, "bags": 6, "damaged": 0}, True)
call(ro, "POST", "/inward", {"source": "OTHER", "source_name": "Local trader", "product_id": chi, "bags": 4, "damaged": 0}, True)
inv = call(own, "GET", "/inventory")
lot = lambda pid, kind: [x for x in inv if x["product_id"] == pid and x.get("bag_kind") == kind][0]["id"]
people = {p["full_name"]: p for p in call(man, "GET", "/tasks/options")["people"]}
roaster = people["Demo Roaster"]["id"]
t1 = call(man, "POST", "/tasks", {"kind": "ROAST", "assigned_to": roaster, "target": 2})["id"]
t2 = call(own, "POST", "/tasks", {"kind": "COUNTER", "assigned_to": roaster, "target": 2})["id"]
call(man, "POST", "/tasks", {"kind": "GENERAL", "title": "Clean roaster chaff collector", "assigned_to": roaster})
prof = call(ro, "GET", "/roast-profiles")[0]["id"]
r1 = call(ro, "POST", "/roasts", {"inputs": [{"lot_id": lot(rob, "SOUND"), "kg": 100}, {"lot_id": lot(rob, "PARTIAL"), "kg": 20}], "output_kg": 101, "duration_min": 17, "profile_id": prof}, True)
r2 = call(ro, "POST", "/roasts", {"inputs": [{"lot_id": lot(ara, "SOUND"), "kg": 60}], "output_kg": 50.6, "duration_min": 15, "profile_id": prof}, True)
call(own, "POST", f"/qc/{r1['id']}/decision", {"decision": "RELEASED", "note": "Colour checked against sample"})
call(own, "POST", f"/qc/{r2['id']}/decision", {"decision": "RELEASED", "note": "Colour checked against sample"})
tasks = {t["id"]: t for t in call(ro, "GET", "/tasks")}

call(ro, "POST", f"/tasks/{t1}/submit", {"note": ""})

r = own.post(B + f"/tasks/{t1}/review", json={"approve": True}); print("owner review (not assigner):", r.status_code, r.json().get("detail"))
call(man, "POST", f"/tasks/{t1}/review", {"approve": True, "note": "Good"})
# counter: grind + transfer
inv = call(own, "GET", "/inventory")
roasted = [x for x in inv if x["stage"] == "ROASTED"][0]["id"]
call(ro, "POST", "/grinds", {"lot_id": roasted, "input_kg": 30, "output_kg": 29.4, "grind": "Filter"}, True)
inv = call(own, "GET", "/inventory")
ground = [x for x in inv if x["stage"] == "GROUND"][0]["id"]
call(ro, "POST", "/transfers", {"lot_id": ground, "kg": 20}, True)
call(ro, "POST", "/transfers", {"lot_id": lot(chi, "SOUND"), "kg": 15}, True)
for t in call(man, "GET", "/transfers"):
    call(man, "POST", f"/transfers/{t['id']}/receive", {"kg_received": t["kg_sent"]})
b = call(ro, "POST", "/counter/sales", {"lines": [{"custom": {"coffee_pct": 80}, "weight_kg": 0.5}], "payments": [{"method": "CASH", "amount_paise": 39000}]}, True)

item = call(ro, "GET", "/counter/setup")["items"][0]["id"]
call(ro, "POST", "/counter/sales", {"customer_name": "Sample Customer", "customer_phone": "9000000001", "lines": [{"item_id": item, "weight_kg": 1}], "payments": [{"method": "UPI", "amount_paise": 72000}]}, True)
r = ro.post(B + "/counter/sales", json={"lines": [{"custom": {"coffee_pct": 80, "override_rate_paise": 50000, "override_reason": "regular"}, "weight_kg": 1}], "payments": [{"method": "CASH", "amount_paise": 50000}]}, headers={"X-Idempotency-Key": "x1"})


# packing ticket for task links
call(man, "POST", "/packing", {"product_name": "Filter blend", "demand_type": "STOCK", "packs_target": 20, "pack_g": 500, "label_ref": "VTC-FB-500"})

# --- extra sample data so every screen has something to act on -----------------
adm = sess("admin", "VTC-Admin-Demo26")
dealer = call(own, "POST", "/masters", {"kind": "customer", "name": "Sample Dealer", "phone": "90000 00002"})["id"]
call(own, "PUT", f"/customers/{cafe}/credit", {"credit_limit_paise": 5000000, "due_days": 15})
call(own, "POST", "/recipes", {"name": "House filter blend", "stage": "ROASTED", "confidential": True,
     "components": [{"name": "Arabica roasted", "pct": 70}, {"name": "Robusta roasted", "pct": 30}]})
oj = call(ro, "POST", "/outside/jobs", {"customer_id": cafe, "received_kg": 40, "charge_basis": "INPUT_KG", "rate_paise": 3000, "bean_type": "Arabica Plantation (customer)"})["id"]
o1 = call(man, "POST", "/orders", {"customer_id": cafe, "item": "Roasted Robusta, medium", "quantity_kg": 10, "form": "ROASTED", "credit_requested": True})["id"]
o2 = call(man, "POST", "/orders", {"customer_id": dealer, "item": "Roasted Arabica beans", "quantity_kg": 5, "form": "ROASTED", "credit_requested": True})["id"]
o3 = call(man, "POST", "/orders", {"customer_id": cafe, "item": "Roasted beans, cash order", "quantity_kg": 2, "form": "ROASTED", "credit_requested": False})["id"]
for o in (o1, o2, o3):
    call(own, "PUT", f"/orders/{o}/price", {"price_per_kg_paise": 52000, "gst_rate_bp": 500})
call(man, "POST", f"/orders/{o1}/confirm")
call(man, "POST", f"/orders/{o2}/confirm")
call(ro, "POST", f"/orders/{o1}/dispatch", {"kg": 4, "mode": "RAPIDO", "booking_ref": "RPD-1", "handover_to": "Rider (sample)", "rest_ok": True}, True)
inv1 = call(own, "GET", "/receivables")["invoices"][0]["id"]
call(man, "POST", f"/invoices/{inv1}/collections", {"amount_paise": 50000, "method": "UPI", "reference": "UPI-1"})
rec = call(own, "GET", "/inward")[-1]["id"]
call(own, "PUT", f"/inward/{rec}/finance", {"invoice_ref": "SUP-1", "invoice_status": "MATCHED", "invoice_amount_paise": 3000000})
call(adm, "POST", f"/receipts/{rec}/payments", {"amount_paise": 1000000, "paid_on": "2026-10-26", "reference": "NEFT-1"})
inbox = call(own, "GET", "/comms/inbox")["conversations"]
ann = [c for c in inbox if c["kind"] == "announcement"][0]["id"]
call(own, "POST", f"/comms/conversations/{ann}/messages", {"body": "Stock count on Saturday 8 am.", "audience": "all"})
grp = [c for c in call(ro, "GET", "/comms/inbox")["conversations"] if c["kind"] == "group"][0]["id"]
call(ro, "POST", f"/comms/conversations/{grp}/messages", {"body": "Drum warmed up."})
call(ro, "POST", "/lots/" + str([x for x in call(own, "GET", "/inventory") if x["status"] == "RELEASED"][0]["id"]) + "/count", {"counted_kg": 1, "note": "test count"})
call(man, "POST", "/tasks", {"kind": "PACK", "assigned_to": people["Demo Packer"]["id"], "target": 4})
# v1.2 latest: maintenance ticket, roaster meter, gas cylinder, cash-view PIN (fictional demo PIN)
call(pk, "POST", "/maintenance", {"title": "Sealer not heating evenly", "area": "PACKING_MACHINE", "urgency": "NORMAL"})
call(ro, "PUT", "/roasts/meter", {"month": "2026-10", "start_reading": 6605})
call(ro, "POST", "/roasts/cylinders", {"kg": 19, "fitted_on": "2026-10-02"})
call(own, "PUT", "/counter/insights/pin", {"pin": "4826"})
# v1.3: hierarchy, a stock card setting and a sample (fictional) staff profile
mid = people["Demo Manager"]["id"]
for who in ("Demo Roaster", "Demo Packer"):
    call(own, "PUT", f"/team/{people[who]['id']}/reports-to", {"reports_to": mid})
card = call(own, "GET", "/stock-cards")[0]["product_id"]
call(own, "PUT", f"/stock-cards/{card}", {"color": "#b5651d", "low_kg": 100})
call(own, "PUT", f"/team/{people['Demo Roaster']['id']}/profile", {"designation": "Head roaster (sample)", "phone": "9000000003", "joined_on": "2024-06-01"})
print("seeded")
