"""Money rules for a counter bill. Pure functions: all amounts in paise (1/100 rupee), weights in grams."""


def half_up(n: float) -> int:
    """Round to the nearest whole number, .5 going up (money must not depend on banker's rounding)."""
    return int(n + 0.5) if n >= 0 else -int(-n + 0.5)


def powder_rate(coffee_pct: int, coffee_rate: int, chicory_rate: int) -> int:
    """Price per kg of powder: coffee% x the coffee type's powder rate + chicory% x the chicory rate."""
    return half_up((coffee_pct * coffee_rate + (100 - coffee_pct) * chicory_rate) / 100)


def line_amount(grams: int, rate_per_kg: int) -> int:
    return half_up(grams * rate_per_kg / 1000)


def max_discount(subtotal: int, cap_pct: float) -> int:
    return int(subtotal * cap_pct / 100)


def round_bill(net: int) -> tuple[int, int]:
    """Bill total rounded to the nearest rupee. Returns (total, round_off)."""
    total = half_up(net / 100) * 100
    return total, total - net


def gst_included(amounts: list[tuple[int, int | None]], discount: int) -> int:
    """GST already inside the prices. Each line's share of the discount is taken off before the tax part is worked out.
    amounts: [(line amount, gst basis points or None)]."""
    subtotal = sum(a for a, _ in amounts)
    gst = 0
    for amount, bp in amounts:
        if not bp:
            continue
        share = amount - (half_up(discount * amount / subtotal) if subtotal else 0)
        gst += half_up(share * bp / (10000 + bp))
    return gst


def tax_breakdown(amounts: list[tuple[int, int | None]], discount: int, state_code: str = "36") -> dict:
    """Breakdown of inclusive GST into Taxable Value and CGST+SGST (state 36 Telangana) or IGST (inter-state)."""
    subtotal = sum(a for a, _ in amounts)
    net_total = subtotal - discount
    total_gst = gst_included(amounts, discount)
    taxable = max(0, net_total - total_gst)
    
    st = str(state_code or "36").strip()
    if st == "36":
        cgst = half_up(total_gst / 2)
        sgst = total_gst - cgst
        igst = 0
    else:
        cgst = 0
        sgst = 0
        igst = total_gst
        
    return {
        "taxable_paise": taxable,
        "gst_paise": total_gst,
        "cgst_paise": cgst,
        "sgst_paise": sgst,
        "igst_paise": igst,
    }


def kg_to_grams(kg_val: float | int) -> int:
    """Convert kilograms to integer grams."""
    return half_up(float(kg_val) * 1000)


def split_grams(form: str, grams: int, coffee_pct: int | None, components: list[dict] | None = None) -> tuple[int, int, int]:
    """(coffee g, chicory g, other g) that went out in this line."""
    if form == "blend" and components:
        # components: list of {item_group, ratio_pct}
        coffee_g, chicory_g, plain_g = 0, 0, 0
        for comp in components:
            g = half_up(grams * comp.get("ratio_pct", 0) / 100)
            grp = comp.get("item_group", "")
            if grp in ("raw_beans", "roasted_beans"):
                coffee_g += g
            elif grp == "chicory":
                chicory_g += g
            else:
                plain_g += g
        # Reconcile rounding to match total grams
        diff = grams - (coffee_g + chicory_g + plain_g)
        if coffee_g:
            coffee_g += diff
        else:
            plain_g += diff
        return coffee_g, chicory_g, plain_g

    if form != "mix":
        return 0, 0, grams
    coffee = half_up(grams * (coffee_pct if coffee_pct is not None else 100) / 100)
    return coffee, grams - coffee, 0
