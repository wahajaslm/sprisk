from typing import Any

# Rows below this share get all-zero features, which a model reads as a value, not as missing.
MIN_COVERAGE = 0.8


def decide(ctx: Any) -> Any:
    audit = ctx.evidence("images.asset_quality")
    if audit is None:
        return ctx.choose("leave_out_images", "The images were not measured, so they are left out.")
    found, rows = audit["found"], audit["rows"]
    share = f"{found} of {rows} rows have a readable image file"
    if rows > 0 and found / rows >= MIN_COVERAGE:
        return ctx.choose(
            "add_image_features", f"{share}, so their features are added before the model."
        )
    return ctx.choose("leave_out_images", f"Only {share}, under 80%, so the images are left out.")
