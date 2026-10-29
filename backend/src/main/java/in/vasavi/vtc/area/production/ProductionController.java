package in.vasavi.vtc.area.production;

import in.vasavi.vtc.common.AlertsService;
import in.vasavi.vtc.common.ApiException;
import in.vasavi.vtc.common.CodesService;
import in.vasavi.vtc.common.LedgerService;
import in.vasavi.vtc.common.Times;
import in.vasavi.vtc.common.ValidationUtils;
import in.vasavi.vtc.common.WorktasksService;
import in.vasavi.vtc.db.Db;
import in.vasavi.vtc.permissions.CurrentUser;
import in.vasavi.vtc.permissions.PermissionService;
import in.vasavi.vtc.security.SessionService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/v1")
public class ProductionController {

    private final Db db;
    private final SessionService sessionService;
    private final PermissionService permissionService;
    private final LedgerService ledger;
    private final CodesService codes;
    private final WorktasksService worktasks;
    private final AlertsService alerts;

    public ProductionController(Db db,
                                SessionService sessionService,
                                PermissionService permissionService,
                                LedgerService ledger,
                                CodesService codes,
                                WorktasksService worktasks,
                                AlertsService alerts) {
        this.db = db;
        this.sessionService = sessionService;
        this.permissionService = permissionService;
        this.ledger = ledger;
        this.codes = codes;
        this.worktasks = worktasks;
        this.alerts = alerts;
    }

    private boolean maySeeFormula(CurrentUser u, Map<String, Object> recipe) {
        boolean confidential = Boolean.TRUE.equals(recipe.get("confidential")) ||
                (recipe.get("confidential") instanceof Number n && n.intValue() == 1);
        return !confidential || u.can("recipe.view_secret") || u.can("recipe.edit");
    }

    private Map<String, Object> recipeOut(CurrentUser u, Map<String, Object> r) {
        long rid = ((Number) r.get("id")).longValue();
        Map<String, Object> v = db.one("SELECT * FROM recipe_versions WHERE recipe_id=? ORDER BY version DESC LIMIT 1", rid);
        if (v == null) return r;
        List<Map<String, Object>> comps = db.readJsonList((String) v.get("components"));
        boolean show = maySeeFormula(u, r);
        boolean confidential = Boolean.TRUE.equals(r.get("confidential")) ||
                (r.get("confidential") instanceof Number n && n.intValue() == 1);

        Map<String, Object> out = new LinkedHashMap<>(r);
        out.put("version", v.get("version"));
        out.put("version_id", v.get("id"));
        out.put("notes", show ? v.get("notes") : "");
        out.put("formula_visible", show);

        if (show) {
            out.put("components", comps);
        } else {
            List<Map<String, Object>> masked = new ArrayList<>();
            for (int i = 0; i < comps.size(); i++) {
                char letter = (char) ('A' + i);
                masked.add(Map.of("name", "Component " + letter, "pct", Optional.empty()));
            }
            out.put("components", masked);
        }

        boolean mayRun = confidential ? u.can("recipe.execute_secret") : (u.can("recipe.view_public") || u.can("recipe.execute_secret"));
        out.put("may_run", mayRun);
        return out;
    }

    private List<Map<String, Object>> parseComponents(Map<String, Object> d) {
        Object compsObj = d.get("components");
        if (!(compsObj instanceof List<?> list) || list.size() < 2 || list.size() > 6) {
            throw new ApiException("RECIPE_NEEDS_2_TO_6_COMPONENTS");
        }
        List<Map<String, Object>> out = new ArrayList<>();
        double sum = 0.0;
        for (Object item : list) {
            if (!(item instanceof Map<?, ?> m)) {
                throw new ApiException("INVALID_COMPONENT");
            }
            Object nameVal = m.get("name");
            String name = (nameVal != null ? nameVal.toString() : "").trim();
            if (name.length() < 2) {
                throw new ApiException("COMPONENT_NAME_REQUIRED");
            }
            if (name.length() > 40) name = name.substring(0, 40);
            double pct = ValidationUtils.number((Map<String, Object>) m, "pct", false);
            pct = Math.round(pct * 100.0) / 100.0;
            sum += pct;
            out.add(Map.of("name", name, "pct", pct));
        }
        if (Math.abs(sum - 100.0) > 0.01) {
            throw new ApiException("RECIPE_MUST_TOTAL_100");
        }
        return out;
    }

    // --- Recipes ---
    @GetMapping("/recipes")
    public List<Map<String, Object>> listRecipes(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "recipe.view_public", "recipe.view_secret", "recipe.execute_secret", "recipe.edit");
        List<Map<String, Object>> rows = db.rows("SELECT * FROM recipes ORDER BY active DESC, name");
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            boolean active = Boolean.TRUE.equals(r.get("active")) || (r.get("active") instanceof Number n && n.intValue() == 1);
            if (active || u.can("recipe.edit")) {
                out.add(recipeOut(u, r));
            }
        }
        return out;
    }

    @PostMapping("/recipes")
    public Map<String, Object> createRecipe(@RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "recipe.edit");
        Map<String, Object> body = d != null ? d : Map.of();
        String name = ValidationUtils.text(body, "name", 2, 60, "NAME_REQUIRED");
        String stage = (String) body.get("stage");
        if (!"RAW".equals(stage) && !"ROASTED".equals(stage)) {
            throw new ApiException("INVALID_STAGE");
        }
        List<Map<String, Object>> comps = parseComponents(body);
        boolean conf = Boolean.TRUE.equals(body.get("confidential"));
        String rawNotes = body.containsKey("notes") ? String.valueOf(body.get("notes")) : "";
        final String notes = rawNotes.length() > 300 ? rawNotes.substring(0, 300) : rawNotes;

        return db.tx(() -> {
            long rid = db.insert("INSERT INTO recipes(name, confidential, stage, created_by, created_at) VALUES(?,?,?,?,?)",
                    name, conf ? 1 : 0, stage, u.getId(), Times.stamp());
            db.exec("INSERT INTO recipe_versions(recipe_id, version, components, notes, created_by, created_at) VALUES(?,?,?,?,?,?)",
                    rid, 1, db.toJson(comps), notes, u.getId(), Times.stamp());
            db.audit(u.getId(), "RECIPE_CREATED", "recipe:" + rid, name + " v1" + (conf ? " (confidential)" : ""));
            return Map.of("id", rid);
        });
    }

    @PutMapping("/recipes/{rid}")
    public Map<String, Object> updateRecipe(@PathVariable long rid, @RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "recipe.edit");
        Map<String, Object> body = d != null ? d : Map.of();
        return db.tx(() -> {
            Map<String, Object> r = db.one("SELECT * FROM recipes WHERE id=?", rid);
            if (r == null) throw new ApiException("NOT_FOUND", 404);
            List<String> notes = new ArrayList<>();
            if (body.containsKey("active")) {
                boolean act = Boolean.TRUE.equals(body.get("active"));
                db.exec("UPDATE recipes SET active=? WHERE id=?", act ? 1 : 0, rid);
                notes.add(act ? "active" : "retired");
            }
            if (body.containsKey("confidential")) {
                boolean conf = Boolean.TRUE.equals(body.get("confidential"));
                db.exec("UPDATE recipes SET confidential=? WHERE id=?", conf ? 1 : 0, rid);
                notes.add(conf ? "confidential" : "not confidential");
            }
            if (body.containsKey("components")) {
                List<Map<String, Object>> comps = parseComponents(body);
                int maxV = db.queryForInt("SELECT COALESCE(MAX(version),0) FROM recipe_versions WHERE recipe_id=?", rid);
                int newV = maxV + 1;
                String verNotes = body.containsKey("notes") ? String.valueOf(body.get("notes")) : "";
                if (verNotes.length() > 300) verNotes = verNotes.substring(0, 300);
                db.exec("INSERT INTO recipe_versions(recipe_id, version, components, notes, created_by, created_at) VALUES(?,?,?,?,?,?)",
                        rid, newV, db.toJson(comps), verNotes, u.getId(), Times.stamp());
                notes.add("new version v" + newV);
            }
            if (notes.isEmpty()) throw new ApiException("NOTHING_TO_CHANGE");
            db.audit(u.getId(), "RECIPE_UPDATED", "recipe:" + rid, r.get("name") + ": " + String.join(", ", notes));
            return Map.of("ok", true);
        });
    }

    // --- Blends ---
    @GetMapping("/blends")
    public List<Map<String, Object>> listBlends(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "recipe.view_public", "recipe.execute_secret", "recipe.view_secret", "recipe.edit");
        return db.rows("SELECT b.*, r.name recipe, r.confidential, v.version, x.full_name made_by FROM blend_jobs b " +
                "JOIN recipe_versions v ON v.id=b.recipe_version_id JOIN recipes r ON r.id=v.recipe_id " +
                "JOIN users x ON x.id=b.created_by ORDER BY b.id DESC LIMIT 100");
    }

    @PostMapping("/blends")
    public Map<String, Object> runBlend(@RequestBody(required = false) Map<String, Object> d,
                                        @RequestHeader(value = "X-Idempotency-Key", required = false) String idemKey,
                                        HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        Map<String, Object> body = d != null ? d : Map.of();
        return db.tx(() -> {
            Map<String, Object> prev = db.idemGet(u.getId(), "BLEND", idemKey);
            if (prev != null) return prev;

            long recipeId = ((Number) body.getOrDefault("recipe_id", 0)).longValue();
            Map<String, Object> r = db.one("SELECT * FROM recipes WHERE id=? AND active=1", recipeId);
            if (r == null) throw new ApiException("RECIPE_NOT_FOUND");

            boolean confidential = Boolean.TRUE.equals(r.get("confidential")) ||
                    (r.get("confidential") instanceof Number n && n.intValue() == 1);
            if (confidential) {
                permissionService.require(u, "recipe.execute_secret");
            } else {
                permissionService.requireAny(u, "recipe.view_public", "recipe.execute_secret");
            }

            Map<String, Object> v = db.one("SELECT * FROM recipe_versions WHERE recipe_id=? ORDER BY version DESC LIMIT 1", r.get("id"));
            List<Map<String, Object>> comps = db.readJsonList((String) v.get("components"));
            Object inputsObj = body.get("inputs");
            if (!(inputsObj instanceof List<?> inputs) || inputs.isEmpty()) {
                throw new ApiException("BLEND_NEEDS_INPUTS");
            }

            double[] perComp = new double[comps.size()];
            List<Map<String, Object>> parsed = new ArrayList<>();
            for (Object item : inputs) {
                Map<String, Object> inMap = (Map<String, Object>) item;
                int ci = ((Number) inMap.getOrDefault("component", -1)).intValue();
                if (ci < 0 || ci >= comps.size()) throw new ApiException("INVALID_COMPONENT");
                double kg = ValidationUtils.r3(ValidationUtils.number(inMap, "kg", true));
                long lotId = ((Number) inMap.getOrDefault("lot_id", 0)).longValue();
                parsed.add(Map.of("ci", ci, "lot_id", lotId, "kg", kg));
                perComp[ci] += kg;
            }
            for (double k : perComp) {
                if (k <= 0) throw new ApiException("EVERY_COMPONENT_NEEDS_A_LOT");
            }
            double total = 0.0;
            for (double k : perComp) total += k;
            total = ValidationUtils.r3(total);
            double output = ValidationUtils.r3(ValidationUtils.number(body, "output_kg", true));
            if (output > total + 1e-4) throw new ApiException("OUTPUT_EXCEEDS_INPUT_OR_ZERO");

            long jid = db.insert("INSERT INTO blend_jobs(recipe_version_id, stage, input_kg, output_kg, loss_kg, notes, created_by, created_at) " +
                            "VALUES(?,?,?,?,?,?,?,?)",
                    v.get("id"), r.get("stage"), total, output, ValidationUtils.r3(total - output),
                    body.getOrDefault("notes", ""), u.getId(), Times.stamp());

            List<String> lotIds = new ArrayList<>();
            for (Map<String, Object> p : parsed) {
                long lid = ((Number) p.get("lot_id")).longValue();
                double kg = ((Number) p.get("kg")).doubleValue();
                ledger.consume(lid, kg, "BLEND_INPUT", jid, u.getId(), "ROASTED".equals(r.get("stage")) ? Set.of("ROASTED", "BLENDED") : Set.of("RAW"), LedgerService.PROD);
                db.exec("INSERT INTO blend_inputs(job_id, lot_id, kg) VALUES(?,?,?)", jid, lid, kg);
                lotIds.add(String.valueOf(lid));
            }

            String stage = "RAW".equals(r.get("stage")) ? "RAW" : "BLENDED";
            String maxRoastedOn = null;
            if (!lotIds.isEmpty()) {
                List<Map<String, Object>> lotRows = db.rows("SELECT roasted_on FROM lots WHERE id IN (" + String.join(",", lotIds) + ") AND roasted_on IS NOT NULL");
                for (Map<String, Object> lr : lotRows) {
                    String ro = (String) lr.get("roasted_on");
                    if (maxRoastedOn == null || (ro != null && ro.compareTo(maxRoastedOn) > 0)) {
                        maxRoastedOn = ro;
                    }
                }
            }

            long out = ledger.newLot(
                    ("RAW".equals(stage) ? "Raw blend: " : "Blend: ") + r.get("name") + " v" + v.get("version") + " (job #" + jid + ")",
                    stage, "RELEASED", "VTC", "PROD-01", null, null, null, null, null, null, null, null, maxRoastedOn
            );
            ledger.move(out, output, "BLEND_OUTPUT", jid, u.getId());
            db.exec("UPDATE blend_jobs SET output_lot_id=? WHERE id=?", out, jid);

            List<Double> actual = new ArrayList<>();
            for (double k : perComp) actual.add(Math.round(k / total * 10000.0) / 100.0);
            worktasks.bump(u.getId(), "BLEND", 1, null);
            db.audit(u.getId(), "BLEND_COMPLETED", "blend:" + jid, r.get("name") + " v" + v.get("version") + ": " + total + " kg -> " + output + " kg");

            boolean show = maySeeFormula(u, r);
            List<Double> targets = new ArrayList<>();
            for (Map<String, Object> c : comps) {
                targets.add(((Number) c.get("pct")).doubleValue());
            }

            Map<String, Object> res = new LinkedHashMap<>();
            res.put("id", jid);
            res.put("output_lot_id", out);
            res.put("code", ledger.lot(out).get("code"));
            res.put("input_kg", total);
            res.put("output_kg", output);
            res.put("actual_pct", show ? actual : null);
            res.put("target_pct", show ? targets : null);

            db.idemSave(u.getId(), "BLEND", idemKey, res);
            return res;
        });
    }

    // --- Grinding ---
    @GetMapping({"/grind", "/grinds"})
    public List<Map<String, Object>> listGrinds(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.requireAny(u, "grind.execute", "recipe.view_public");
        return db.rows("SELECT g.*, l.name input_name, x.full_name made_by FROM grind_jobs g JOIN lots l ON l.id=g.input_lot_id " +
                "JOIN users x ON x.id=g.created_by ORDER BY g.id DESC LIMIT 100");
    }

    @PostMapping({"/grind", "/grinds"})
    public Map<String, Object> runGrind(@RequestBody(required = false) Map<String, Object> d,
                                        @RequestHeader(value = "X-Idempotency-Key", required = false) String idemKey,
                                        HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "grind.execute");
        Map<String, Object> body = d != null ? d : Map.of();
        double kgIn = ValidationUtils.r3(ValidationUtils.number(body, "input_kg", true));
        double kgOut = ValidationUtils.r3(ValidationUtils.number(body, "output_kg", true));
        if (kgOut > kgIn + 1e-4) throw new ApiException("OUTPUT_EXCEEDS_INPUT_OR_ZERO");
        String grind = ValidationUtils.text(body, "grind", 2, 30, "GRIND_SIZE_REQUIRED");

        return db.tx(() -> {
            Map<String, Object> prev = db.idemGet(u.getId(), "GRIND", idemKey);
            if (prev != null) return prev;

            long lid = ((Number) body.getOrDefault("lot_id", 0)).longValue();
            long gid = db.insert("INSERT INTO grind_jobs(input_lot_id, input_kg, output_kg, grind, created_by, created_at) " +
                    "VALUES(?,?,?,?,?,?)", lid, kgIn, kgOut, grind, u.getId(), Times.stamp());

            Map<String, Object> src = ledger.consume(lid, kgIn, "GRIND_INPUT", gid, u.getId(), Set.of("ROASTED", "BLENDED"), LedgerService.PROD);
            long beanOrProd = src.get("bean_id") != null ? ((Number) src.get("bean_id")).longValue() : ((Number) src.get("product_id")).longValue();

            long out = ledger.newLot(
                    "Ground (" + grind + ") from lot #" + lid,
                    "GROUND", "RELEASED", "VTC", "PROD-01", null, null, null, null, null, null, beanOrProd, null,
                    (String) src.get("roasted_on")
            );
            ledger.move(out, kgOut, "GRIND_OUTPUT", gid, u.getId());
            db.exec("UPDATE grind_jobs SET output_lot_id=? WHERE id=?", out, gid);
            worktasks.bump(u.getId(), "BLEND", 1, null);
            db.audit(u.getId(), "GRIND_COMPLETED", "grind:" + gid, src.get("name") + ": " + kgIn + " kg -> " + kgOut + " kg " + grind);

            Map<String, Object> res = Map.of(
                    "id", gid,
                    "output_lot_id", out,
                    "code", ledger.lot(out).get("code"),
                    "loss_kg", ValidationUtils.r3(kgIn - kgOut)
            );
            db.idemSave(u.getId(), "GRIND", idemKey, res);
            return res;
        });
    }

    // --- Outside (Customer-owned) Roasting ---
    @GetMapping({"/outside", "/outside/jobs"})
    public Map<String, Object> outsideJobs(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "outside.view");
        List<Map<String, Object>> rows = db.rows("SELECT j.*, m.name customer FROM outside_jobs j JOIN masters m ON m.id=j.customer_id ORDER BY j.id DESC");
        for (Map<String, Object> r : rows) {
            long rawLot = ((Number) r.get("raw_lot_id")).longValue();
            r.put("raw_left_kg", ledger.balance(rawLot));
            Object rLot = r.get("roasted_lot_id");
            r.put("roasted_left_kg", rLot != null ? ledger.balance(((Number) rLot).longValue()) : 0.0);
            if (!u.can("finance.collection.record") && !u.can("finance.view")) {
                r.remove("rate_paise");
                r.remove("charge_paise");
                r.remove("payment_status");
            }
        }
        List<Map<String, Object>> customers = db.rows("SELECT id, name FROM masters WHERE kind='customer' AND state='ACTIVE' ORDER BY name");
        return Map.of("jobs", rows, "customers", customers);
    }

    @PostMapping({"/outside", "/outside/receive", "/outside/jobs"})
    public Map<String, Object> outsideReceive(@RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "outside.execute");
        Map<String, Object> body = d != null ? d : Map.of();
        double kg = ValidationUtils.r3(ValidationUtils.number(body, "received_kg", true));
        String basis = (String) body.get("charge_basis");
        if (!"INPUT_KG".equals(basis) && !"OUTPUT_KG".equals(basis) && !"BATCH".equals(basis)) {
            throw new ApiException("INVALID_CHARGE_BASIS");
        }
        long rate = ((Number) body.getOrDefault("rate_paise", 0)).longValue();
        if (rate <= 0) throw new ApiException("RATE_REQUIRED");
        String bean = ValidationUtils.text(body, "bean_type", 2, 80, "BEAN_TYPE_REQUIRED");

        return db.tx(() -> {
            long custId = ((Number) body.getOrDefault("customer_id", 0)).longValue();
            Map<String, Object> cust = db.one("SELECT * FROM masters WHERE id=? AND kind='customer' AND state='ACTIVE'", custId);
            if (cust == null) throw new ApiException("ACTIVE_CUSTOMER_REQUIRED");

            String owner = "CUST:" + custId;
            long lot = ledger.newLot(cust.get("name") + " - their " + bean, "RAW", "RELEASED", owner, "PROD-01", null, null, null, custId, null, null, null, null, null);
            long jid = db.insert("INSERT INTO outside_jobs(customer_id, received_kg, raw_lot_id, charge_basis, rate_paise, state, created_by, created_at, bean_type) " +
                    "VALUES(?,?,?,?,?,?,?,?,?)", custId, kg, lot, basis, rate, "RECEIVED", u.getId(), Times.stamp(), bean);
            ledger.move(lot, kg, "CUSTOMER_MATERIAL_IN", jid, u.getId());
            db.audit(u.getId(), "OUTSIDE_RECEIVED", "outside:" + jid, cust.get("name") + ": " + kg + " kg " + bean + " received");
            return Map.of("id", jid);
        });
    }

    @PostMapping("/outside/jobs/{jid}/roast")
    public Map<String, Object> outsideRoast(@PathVariable long jid, @RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "outside.execute");
        Map<String, Object> body = d != null ? d : Map.of();
        double kgIn = ValidationUtils.r3(ValidationUtils.number(body, "input_kg", true));
        double kgOut = ValidationUtils.r3(ValidationUtils.number(body, "output_kg", true));
        if (kgOut > kgIn + 1e-4) throw new ApiException("OUTPUT_EXCEEDS_INPUT_OR_ZERO");

        return db.tx(() -> {
            Map<String, Object> j = db.one("SELECT * FROM outside_jobs WHERE id=?", jid);
            if (j == null) throw new ApiException("NOT_FOUND", 404);
            if (j.get("roasted_lot_id") != null) throw new ApiException("ALREADY_ROASTED");
            long custId = ((Number) j.get("customer_id")).longValue();
            String owner = "CUST:" + custId;
            long rawLotId = ((Number) j.get("raw_lot_id")).longValue();

            ledger.consume(rawLotId, kgIn, "OUTSIDE_ROAST_INPUT", jid, u.getId(), null, null, owner);
            long out = ledger.newLot("Customer roasted (job #" + jid + ")", "ROASTED", "RELEASED", owner, "PROD-01", null, null, null, custId, null, null, null, null, codes.isoDay());
            ledger.move(out, kgOut, "OUTSIDE_ROAST_OUTPUT", jid, u.getId());

            String basis = (String) j.get("charge_basis");
            long rate = ((Number) j.get("rate_paise")).longValue();
            long charge = "INPUT_KG".equals(basis) ? Math.round(kgIn * rate) : ("OUTPUT_KG".equals(basis) ? Math.round(kgOut * rate) : rate);

            db.exec("UPDATE outside_jobs SET input_kg=?, output_kg=?, loss_kg=?, roasted_lot_id=?, charge_paise=?, state='ROASTED' WHERE id=?",
                    kgIn, kgOut, ValidationUtils.r3(kgIn - kgOut), out, charge, jid);
            worktasks.bump(u.getId(), "OUTSIDE", 1, null);
            db.audit(u.getId(), "OUTSIDE_ROASTED", "outside:" + jid, kgIn + " kg -> " + kgOut + " kg; service charge Rs." + (charge / 100.0));
            return Map.of("ok", true, "charge_paise", charge);
        });
    }

    @PostMapping("/outside/jobs/{jid}/return")
    public Map<String, Object> outsideReturn(@PathVariable long jid, @RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "outside.execute");
        Map<String, Object> body = d != null ? d : Map.of();
        double kg = ValidationUtils.r3(ValidationUtils.number(body, "kg", true));
        String what = body.getOrDefault("what", "roasted").toString();
        String note = ValidationUtils.text(body, "note", 3, 200, "HANDOVER_NOTE_REQUIRED");

        return db.tx(() -> {
            Map<String, Object> j = db.one("SELECT * FROM outside_jobs WHERE id=?", jid);
            if (j == null) throw new ApiException("NOT_FOUND", 404);
            long lot = "roasted".equals(what) && j.get("roasted_lot_id") != null ? ((Number) j.get("roasted_lot_id")).longValue() : ((Number) j.get("raw_lot_id")).longValue();
            long custId = ((Number) j.get("customer_id")).longValue();
            String owner = "CUST:" + custId;

            ledger.consume(lot, kg, "RETURNED_TO_CUSTOMER", jid, u.getId(), null, null, owner);
            double left = ledger.balance(((Number) j.get("raw_lot_id")).longValue()) + (j.get("roasted_lot_id") != null ? ledger.balance(((Number) j.get("roasted_lot_id")).longValue()) : 0.0);
            String existingNote = (String) j.get("return_note");
            String newNote = (existingNote == null || existingNote.isBlank()) ? note : (existingNote + " | " + note);
            String state = left <= 1e-4 ? "RETURNED" : (String) j.get("state");

            db.exec("UPDATE outside_jobs SET returned_kg=returned_kg+?, return_note=?, state=? WHERE id=?", kg, newNote, state, jid);
            db.audit(u.getId(), "OUTSIDE_RETURNED", "outside:" + jid, kg + " kg " + what + " handed back: " + note);
            return Map.of("ok", true);
        });
    }

    // --- Packing ---
    @GetMapping("/packing")
    public Map<String, Object> packing(HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "pack.view");
        List<Map<String, Object>> rows = db.rows(
                "SELECT p.*, l.status finished_status, x.full_name created_by_name " +
                "FROM pack_jobs p " +
                "LEFT JOIN lots l ON l.id=p.output_lot_id " +
                "LEFT JOIN users x ON x.id=p.created_by " +
                "ORDER BY p.id DESC"
        );
        List<Map<String, Object>> sources = ledger.stockRows(
                "l.location=? AND l.owner='VTC' AND l.status='RELEASED' AND l.stage IN ('ROASTED','BLENDED','GROUND')",
                LedgerService.PROD
        ).stream().filter(s -> ((Number) s.getOrDefault("available_kg", 0.0)).doubleValue() > 0).toList();
        return Map.of("jobs", rows, "sources", sources);
    }

    @PostMapping("/packing")
    public Map<String, Object> createPackJob(@RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "pack.create");
        Map<String, Object> body = d != null ? d : Map.of();
        String name = ValidationUtils.text(body, "product_name", 2, 120, "INVALID_PACK_JOB");
        String mode = (String) body.get("demand_type");
        if (!"ORDER".equals(mode) && !"STOCK".equals(mode)) throw new ApiException("INVALID_PACK_JOB");
        int count = ValidationUtils.integer(body, "packs_target", 1, "COUNT_REQUIRED");
        double grams = ValidationUtils.number(body, "pack_g", true);

        return db.tx(() -> {
            long pid = db.insert("INSERT INTO pack_jobs(product_name, demand_type, packs_target, pack_g, label_ref, order_id, created_by, created_at) " +
                    "VALUES(?,?,?,?,?,?,?,?)", name, mode, count, grams, body.getOrDefault("label_ref", ""), body.get("order_id"), u.getId(), Times.stamp());
            db.audit(u.getId(), "PACK_TICKET_CREATED", "pack:" + pid, count + " x " + grams + " g " + name);
            return Map.of("id", pid, "state", "DRAFT");
        });
    }

    @PostMapping("/packing/{pid}/run")
    public Map<String, Object> packRun(@PathVariable long pid,
                                       @RequestBody(required = false) Map<String, Object> d,
                                       @RequestHeader(value = "X-Idempotency-Key", required = false) String idemKey,
                                       HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "pack.execute");
        Map<String, Object> body = d != null ? d : Map.of();
        double kgIn = ValidationUtils.r3(ValidationUtils.number(body, "input_kg", true));
        int good = ValidationUtils.integer(body, "good_packs", 0, "INVALID_PACK_COUNT");
        int rejected = ValidationUtils.integer(body, "rejected_packs", 0, "INVALID_REJECT_COUNT");
        if (good + rejected == 0) throw new ApiException("COUNT_THE_PACKS");

        return db.tx(() -> {
            Map<String, Object> prev = db.idemGet(u.getId(), "PACK_RUN", idemKey);
            if (prev != null) return prev;

            Map<String, Object> p = db.one("SELECT * FROM pack_jobs WHERE id=?", pid);
            if (p == null) throw new ApiException("NOT_FOUND", 404);
            int packsDone = ((Number) p.get("packs_done")).intValue();
            int packsTarget = ((Number) p.get("packs_target")).intValue();
            if (packsDone + good > packsTarget) throw new ApiException("PACK_COUNT_EXCEEDS_TARGET");

            double packG = ((Number) p.get("pack_g")).doubleValue();
            double packedKg = ValidationUtils.r3(good * packG / 1000.0);
            if (packedKg > kgIn + 1e-4) throw new ApiException("PACKED_MORE_THAN_COFFEE_USED");

            long srcId = ((Number) body.getOrDefault("source_lot_id", 0)).longValue();
            Object prevSrcId = p.get("source_lot_id");
            if (prevSrcId != null && ((Number) prevSrcId).longValue() != 0 && ((Number) prevSrcId).longValue() != srcId) {
                throw new ApiException("USE_THE_SAME_SOURCE_LOT");
            }

            Map<String, Object> srcl = ledger.consume(srcId, kgIn, "PACK_INPUT", pid, u.getId(), Set.of("ROASTED", "BLENDED", "GROUND"), LedgerService.PROD);
            Object outObj = p.get("output_lot_id");
            Long out = outObj != null ? ((Number) outObj).longValue() : null;
            if (out != null && !"QC_HOLD".equals(ledger.lot(out).get("status"))) {
                out = null;
            }
            if (out == null) {
                long beanOrProd = srcl.get("bean_id") != null ? ((Number) srcl.get("bean_id")).longValue() : ((Number) srcl.get("product_id")).longValue();
                out = ledger.newLot(p.get("product_name") + " " + packG + " g packs (ticket #" + pid + ")",
                        "PACKED", "QC_HOLD", "VTC", (Long) null, (String) null, (Long) null, (Long) null, (Long) null, packG, beanOrProd, "PCK", (String) srcl.get("roasted_on"));
            }
            if (packedKg > 0) {
                ledger.move(out, packedKg, "PACK_OUTPUT", pid, u.getId());
            }

            int done = packsDone + good;
            String state = (done == packsTarget) ? "RECORDED_PENDING_QA" : "IN_PROGRESS";
            db.exec("UPDATE pack_jobs SET source_lot_id=?, input_kg=COALESCE(input_kg,0)+?, packs_done=?, rejected_packs=rejected_packs+?, " +
                    "output_lot_id=?, state=? WHERE id=?", srcId, kgIn, done, rejected, out, state, pid);
            if (good > 0) worktasks.bump(u.getId(), "PACK", good, pid);
            db.audit(u.getId(), "PACK_RUN", "pack:" + pid, good + " good + " + rejected + " rejected packs from " + kgIn + " kg");

            Map<String, Object> res = Map.of(
                    "ok", true,
                    "state", state,
                    "packs_done", done,
                    "loss_kg", ValidationUtils.r3(kgIn - packedKg),
                    "lot_id", out,
                    "code", ledger.lot(out).get("code"),
                    "packs", good
            );
            db.idemSave(u.getId(), "PACK_RUN", idemKey, res);
            return res;
        });
    }

    @PostMapping("/packing/{pid}/release")
    public Map<String, Object> packRelease(@PathVariable long pid, @RequestBody(required = false) Map<String, Object> d, HttpServletRequest req) {
        CurrentUser u = sessionService.current(req);
        permissionService.require(u, "pack.qa_approve");
        Map<String, Object> body = d != null ? d : Map.of();
        boolean approve = !body.containsKey("approve") || Boolean.TRUE.equals(body.get("approve"));
        String note = ValidationUtils.text(body, "note", 3, 200, "REASON_REQUIRED");

        return db.tx(() -> {
            Map<String, Object> p = db.one("SELECT * FROM pack_jobs WHERE id=?", pid);
            if (p == null || p.get("output_lot_id") == null) throw new ApiException("NOTHING_PACKED_YET");
            long outLotId = ((Number) p.get("output_lot_id")).longValue();
            Map<String, Object> lot = ledger.lot(outLotId);
            if (!"QC_HOLD".equals(lot.get("status"))) throw new ApiException("ALREADY_DECIDED");

            db.exec("UPDATE lots SET status=? WHERE id=?", approve ? "RELEASED" : "REJECTED", outLotId);
            if (approve && "RECORDED_PENDING_QA".equals(p.get("state"))) {
                db.exec("UPDATE pack_jobs SET state='COMPLETE' WHERE id=?", pid);
            }
            db.audit(u.getId(), "PACK_QA_" + (approve ? "RELEASED" : "REJECTED"), "pack:" + pid, note);
            return Map.of("ok", true);
        });
    }
}
