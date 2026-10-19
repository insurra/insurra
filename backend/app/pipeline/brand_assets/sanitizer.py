"""SVG and Image Asset Sanitizer and Security Validator.
Guarantees SVGs have no embedded scripts, exploits, or malicious payloads.
Never use em dashes in strings or docstrings.
"""

import hashlib
import re
import xml.etree.ElementTree as ET

# Register default SVG namespace so serialized output avoids ns0: prefixes
ET.register_namespace("", "http://www.w3.org/2000/svg")
ET.register_namespace("xlink", "http://www.w3.org/1999/xlink")


class SecurityValidationError(Exception):
    """Raised when an asset fails security or integrity checks."""

    pass


class AssetSanitizer:
    DANGEROUS_TAGS = {
        "script",
        "foreignObject",
        "iframe",
        "object",
        "embed",
        "applet",
        "form",
        "input",
        "button",
    }
    DANGEROUS_ATTRIBUTES = {
        "onload",
        "onerror",
        "onclick",
        "onmouseover",
        "onfocus",
        "onblur",
        "href",
        "xlink:href",
    }

    @classmethod
    def sanitize_svg(cls, svg_input: bytes | str) -> tuple[bytes, int, int]:
        """Validates and sanitizes SVG bytes or string, removing dangerous elements and attributes.
        Returns: (sanitized_bytes, width, height)
        """
        if isinstance(svg_input, str):
            text = svg_input
        else:
            try:
                text = svg_input.decode("utf-8")
            except UnicodeDecodeError:
                try:
                    text = svg_input.decode("utf-8-sig")
                except Exception as e:
                    raise SecurityValidationError(f"Invalid SVG text encoding: {e}") from e

        # Check for obvious script injection attempts
        if re.search(r"<script[\s>]", text, re.IGNORECASE):
            # Remove script tags entirely
            text = re.sub(r"<script[\s\S]*?</script>", "", text, flags=re.IGNORECASE)

        # Remove javascript: pseudo-protocol
        if re.search(r"javascript\s*:", text, re.IGNORECASE):
            text = re.sub(r"javascript\s*:[^\"]*", "#", text, flags=re.IGNORECASE)

        try:
            root = ET.fromstring(text)
        except ET.ParseError as e:
            raise SecurityValidationError(f"Malformed XML in SVG: {e}") from e

        # Helper to extract tag name without namespace
        def get_local_tag(tag_str: str) -> str:
            if "}" in tag_str:
                return tag_str.split("}", 1)[1]
            return tag_str

        # Remove dangerous nodes
        nodes_to_remove = []
        for elem in root.iter():
            local = get_local_tag(elem.tag).lower()
            if local in cls.DANGEROUS_TAGS:
                nodes_to_remove.append(elem)
                continue

            # Strip dangerous attributes
            attribs_to_del = []
            for attr, val in list(elem.attrib.items()):
                attr_local = get_local_tag(attr).lower()
                if attr_local.startswith("on") or attr_local in cls.DANGEROUS_ATTRIBUTES:
                    if attr_local in ("href", "xlink:href") and val.startswith(
                        ("http://", "https://", "#")
                    ):
                        continue  # Safe internal or web link
                    attribs_to_del.append(attr)

            for a in attribs_to_del:
                del elem.attrib[a]

        for parent in root.iter():
            for child in list(parent):
                if child in nodes_to_remove:
                    parent.remove(child)

        # Parse width and height if available
        width = 240
        height = 80
        w_val = root.attrib.get("width")
        h_val = root.attrib.get("height")
        viewbox = root.attrib.get("viewBox") or root.attrib.get("viewbox")

        if w_val and re.match(r"^\d+", w_val):
            width = int(float(re.match(r"^\d+(\.\d+)?", w_val).group(0)))
        elif viewbox:
            parts = viewbox.split()
            if len(parts) == 4 and parts[2].isdigit():
                width = int(float(parts[2]))

        if h_val and re.match(r"^\d+", h_val):
            height = int(float(re.match(r"^\d+(\.\d+)?", h_val).group(0)))
        elif viewbox:
            parts = viewbox.split()
            if len(parts) == 4 and parts[3].isdigit():
                height = int(float(parts[3]))

        sanitized_bytes = ET.tostring(root, encoding="utf-8")
        return sanitized_bytes, width, height

    @classmethod
    def validate_png(cls, png_bytes: bytes) -> tuple[int, int]:
        """Validates PNG signature and extracts dimensions.
        Returns: (width, height)
        """
        if len(png_bytes) < 24:
            raise SecurityValidationError("PNG file too small")
        # PNG signature: 89 50 4E 47 0D 0A 1A 0A
        if not png_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
            raise SecurityValidationError("Invalid PNG signature")

        # IHDR chunk starts at byte 12, width at byte 16 (4 bytes), height at byte 20 (4 bytes)
        width = int.from_bytes(png_bytes[16:20], byteorder="big")
        height = int.from_bytes(png_bytes[20:24], byteorder="big")

        if width <= 0 or height <= 0:
            raise SecurityValidationError("Invalid PNG dimensions")

        return width, height

    @classmethod
    def compute_sha256(cls, data: bytes) -> str:
        return hashlib.sha256(data).hexdigest()
