"""Physics tab data: factor trade study + aircraft study + validation error -> site/geo/physics.json"""
import json, os
H = os.path.dirname(os.path.abspath(__file__))
S = json.load(open(os.path.join(H, "results", "sensitivity.json")))
A = json.load(open(os.path.join(H, "results", "aircraft.json")))
V = None
vp = os.path.join(H, "results", "validation.json")
if os.path.exists(vp):
    v = json.load(open(vp))["stats"]
    V = {g: v[g] for g in ("all", "FL350", "FL450", "FL550", "winter", "rest", "anydir") if g in v}
out = dict(studies=S["studies"], altitude=S["altitude"], horizontal=S["horizontal"],
           aircraft=dict(types=A["types"], buffer_by_length=A["buffer_by_length"], model=A["model"]),
           validation=V)
json.dump(out, open(os.path.join(H, "..", "site", "geo", "physics.json"), "w"), ensure_ascii=False)
print("wrote site/geo/physics.json", os.path.getsize(os.path.join(H, "..", "site", "geo", "physics.json")))
