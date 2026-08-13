// MetaGen Pro - EPS Engine Module
document.addEventListener('DOMContentLoaded', function () {

    const previewContainer = document.getElementById('filePreviewContainer');
    const processAllButton = document.getElementById('processAllButton');
    const processAllPromptsButton = document.getElementById('processAllPromptsButton');
    const exportButton = document.getElementById('exportButton');
    const embedMetadataButton = document.getElementById('embedMetadataButton');
    const clearAllButton = document.getElementById('clearAllButton');
    if (!window.uploadedFilesData) window.uploadedFilesData = [];
    const uploadedFilesData = window.uploadedFilesData;

    // ==========================================
    // ADOBE STOCK EPS10 GENERATOR (CLIENT-SIDE)
    // ==========================================

    window.AdobeStockEpsGenerator = class AdobeStockEpsGenerator {
        constructor(svgElement) {
            this.svg = svgElement;
            this.viewBox = this.getViewBox();
            this.psCommands = [];
            this.actualBounds = null;
        }

        getViewBox() {
            const vb = this.svg.getAttribute('viewBox');
            if (vb) {
                const parts = vb.split(/\s+|,/);
                return {
                    x: parseFloat(parts[0]) || 0,
                    y: parseFloat(parts[1]) || 0,
                    width: parseFloat(parts[2]) || 100,
                    height: parseFloat(parts[3]) || 100
                };
            }
            return {
                x: 0,
                y: 0,
                width: parseFloat(this.svg.getAttribute('width')) || 100,
                height: parseFloat(this.svg.getAttribute('height')) || 100
            };
        }

        generate() {
            this.parseSVGPaths();
            this.calculateActualBounds();
            return this.buildEPS10();
        }

        calculateActualBounds() {
            // Calculate bounding box from all paths
            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;

            this.psCommands.forEach(({ path }) => {
                const coords = this.extractCoordinates(path);
                coords.forEach(({ x, y }) => {
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x);
                    maxY = Math.max(maxY, y);
                });
            });

            // If no paths found, use viewBox
            if (!isFinite(minX)) {
                this.actualBounds = {
                    x: this.viewBox.x,
                    y: this.viewBox.y,
                    width: this.viewBox.width,
                    height: this.viewBox.height
                };
            } else {
                // Add 5% padding for Adobe Stock requirements
                const padding = Math.max((maxX - minX), (maxY - minY)) * 0.05;
                this.actualBounds = {
                    x: minX - padding,
                    y: minY - padding,
                    width: (maxX - minX) + (padding * 2),
                    height: (maxY - minY) + (padding * 2)
                };
            }
        }

        extractCoordinates(pathData) {
            const coords = [];
            const commands = pathData.match(/[a-df-z][^a-df-z]*/gi) || [];

            let currentX = 0, currentY = 0;

            commands.forEach(cmd => {
                const type = cmd[0];
                const args = cmd.slice(1).trim().split(/[\s,]+/).map(parseFloat).filter(n => !isNaN(n));

                switch (type.toUpperCase()) {
                    case 'M':
                    case 'L':
                        if (args.length >= 2) {
                            currentX = type === type.toUpperCase() ? args[0] : currentX + args[0];
                            currentY = type === type.toUpperCase() ? args[1] : currentY + args[1];
                            coords.push({ x: currentX, y: currentY });
                        }
                        break;
                    case 'H':
                        currentX = type === 'H' ? args[0] : currentX + args[0];
                        coords.push({ x: currentX, y: currentY });
                        break;
                    case 'V':
                        currentY = type === 'V' ? args[0] : currentY + args[0];
                        coords.push({ x: currentX, y: currentY });
                        break;
                    case 'C':
                        if (args.length >= 6) {
                            currentX = type === 'C' ? args[4] : currentX + args[4];
                            currentY = type === 'C' ? args[5] : currentY + args[5];
                            coords.push({ x: currentX, y: currentY });
                        }
                        break;
                }
            });

            return coords;
        }

        parseSVGPaths() {
            // Get all path elements
            const paths = this.svg.querySelectorAll('path, rect, circle, ellipse, polygon, polyline, line');

            paths.forEach(element => {
                const pathData = this.elementToPath(element);
                if (pathData) {
                    const fill = this.getColor(element, 'fill');
                    const stroke = this.getColor(element, 'stroke');
                    const strokeWidth = parseFloat(element.getAttribute('stroke-width')) || 1;

                    this.psCommands.push({
                        path: pathData,
                        fill: fill,
                        stroke: stroke,
                        strokeWidth: strokeWidth
                    });
                }
            });
        }

        elementToPath(element) {
            const tag = element.tagName.toLowerCase();

            if (tag === 'path') {
                return element.getAttribute('d');
            } else if (tag === 'rect') {
                const x = parseFloat(element.getAttribute('x')) || 0;
                const y = parseFloat(element.getAttribute('y')) || 0;
                const w = parseFloat(element.getAttribute('width')) || 0;
                const h = parseFloat(element.getAttribute('height')) || 0;
                return `M${x},${y} L${x + w},${y} L${x + w},${y + h} L${x},${y + h} Z`;
            } else if (tag === 'circle') {
                const cx = parseFloat(element.getAttribute('cx')) || 0;
                const cy = parseFloat(element.getAttribute('cy')) || 0;
                const r = parseFloat(element.getAttribute('r')) || 0;
                // Approximate circle with bezier curves
                const k = 0.5522847498;
                const kappa = r * k;
                return `M${cx - r},${cy} C${cx - r},${cy - kappa} ${cx - kappa},${cy - r} ${cx},${cy - r} C${cx + kappa},${cy - r} ${cx + r},${cy - kappa} ${cx + r},${cy} C${cx + r},${cy + kappa} ${cx + kappa},${cy + r} ${cx},${cy + r} C${cx - kappa},${cy + r} ${cx - r},${cy + kappa} ${cx - r},${cy} Z`;
            } else if (tag === 'line') {
                const x1 = parseFloat(element.getAttribute('x1')) || 0;
                const y1 = parseFloat(element.getAttribute('y1')) || 0;
                const x2 = parseFloat(element.getAttribute('x2')) || 0;
                const y2 = parseFloat(element.getAttribute('y2')) || 0;
                return `M${x1},${y1} L${x2},${y2}`;
            } else if (tag === 'polygon' || tag === 'polyline') {
                const points = element.getAttribute('points');
                if (!points) return null;
                const pairs = points.trim().split(/\s+|,/).filter(p => p);
                let path = '';
                for (let i = 0; i < pairs.length; i += 2) {
                    const x = pairs[i];
                    const y = pairs[i + 1];
                    path += (i === 0 ? `M${x},${y}` : ` L${x},${y}`);
                }
                if (tag === 'polygon') path += ' Z';
                return path;
            }

            return null;
        }

        getColor(element, type) {
            let color = element.getAttribute(type);
            if (!color || color === 'none') {
                const style = element.getAttribute('style');
                if (style) {
                    const match = style.match(new RegExp(`${type}:\\s*([^;]+)`));
                    if (match) color = match[1].trim();
                }
            }

            if (!color || color === 'none') return null;

            // Convert hex to RGB
            if (color.startsWith('#')) {
                const hex = color.slice(1);
                const r = parseInt(hex.substr(0, 2), 16) / 255;
                const g = parseInt(hex.substr(2, 2), 16) / 255;
                const b = parseInt(hex.substr(4, 2), 16) / 255;
                return { r, g, b };
            } else if (color.startsWith('rgb')) {
                const match = color.match(/\d+/g);
                if (match) {
                    return {
                        r: parseInt(match[0]) / 255,
                        g: parseInt(match[1]) / 255,
                        b: parseInt(match[2]) / 255
                    };
                }
            }

            // Default black
            return { r: 0, g: 0, b: 0 };
        }

        svgPathToPostScript(pathData) {
            if (!pathData) return '';

            let ps = '';
            const commands = pathData.match(/[a-df-z][^a-df-z]*/gi) || [];

            let currentX = 0, currentY = 0;
            let startX = 0, startY = 0;

            commands.forEach(cmd => {
                const type = cmd[0];
                const args = cmd.slice(1).trim().split(/[\s,]+/).map(parseFloat).filter(n => !isNaN(n));

                const transformY = (y) => bounds.height - (y - bounds.y); // SVG Y-down to PS Y-up

                switch (type.toUpperCase()) {
                    case 'M': // moveto
                        currentX = type === 'M' ? args[0] : currentX + args[0];
                        currentY = type === 'M' ? args[1] : currentY + args[1];
                        startX = currentX;
                        startY = currentY;
                        ps += `${currentX.toFixed(2)} ${transformY(currentY).toFixed(2)} moveto\n`;
                        break;

                    case 'L': // lineto
                        currentX = type === 'L' ? args[0] : currentX + args[0];
                        currentY = type === 'L' ? args[1] : currentY + args[1];
                        ps += `${currentX.toFixed(2)} ${transformY(currentY).toFixed(2)} lineto\n`;
                        break;

                    case 'H': // horizontal line
                        currentX = type === 'H' ? args[0] : currentX + args[0];
                        ps += `${currentX.toFixed(2)} ${transformY(currentY).toFixed(2)} lineto\n`;
                        break;

                    case 'V': // vertical line
                        currentY = type === 'V' ? args[0] : currentY + args[0];
                        ps += `${currentX.toFixed(2)} ${transformY(currentY).toFixed(2)} lineto\n`;
                        break;

                    case 'C': // cubic bezier
                        if (args.length >= 6) {
                            const x1 = type === 'C' ? args[0] : currentX + args[0];
                            const y1 = type === 'C' ? args[1] : currentY + args[1];
                            const x2 = type === 'C' ? args[2] : currentX + args[2];
                            const y2 = type === 'C' ? args[3] : currentY + args[3];
                            currentX = type === 'C' ? args[4] : currentX + args[4];
                            currentY = type === 'C' ? args[5] : currentY + args[5];
                            ps += `${x1.toFixed(2)} ${transformY(y1).toFixed(2)} ${x2.toFixed(2)} ${transformY(y2).toFixed(2)} ${currentX.toFixed(2)} ${transformY(currentY).toFixed(2)} curveto\n`;
                        }
                        break;

                    case 'Z': // closepath
                        ps += `closepath\n`;
                        currentX = startX;
                        currentY = startY;
                        break;
                }
            });

            return ps;
        }

        buildEPS10() {
            const date = new Date().toISOString();
            const bounds = this.actualBounds;

            // Use actual bounds for BoundingBox
            let eps = `%!PS-Adobe-3.0 EPSF-3.0
%%BoundingBox: 0 0 ${Math.ceil(bounds.width)} ${Math.ceil(bounds.height)}
%%HiResBoundingBox: 0.0 0.0 ${bounds.width.toFixed(4)} ${bounds.height.toFixed(4)}
%%Creator: MetaGen Pro - Adobe Stock Metadata Generator
%%Title: Vector Illustration - Adobe Stock Compatible
%%CreationDate: ${date}
%%DocumentData: Clean7Bit
%%Origin: 0 0
%%Pages: 1
%%LanguageLevel: 2
%%EndComments

%%BeginProlog
%%EndProlog

%%BeginSetup
%%EndSetup

%%Page: 1 1
gsave

% Translate to align content with artboard origin
${(-bounds.x).toFixed(2)} ${(-bounds.y).toFixed(2)} translate

`;

            // Draw all paths
            this.psCommands.forEach(({ path, fill, stroke, strokeWidth }) => {
                const psPath = this.svgPathToPostScript(path, bounds);

                if (psPath) {
                    eps += `% New path\nnewpath\n`;
                    eps += psPath;

                    if (fill) {
                        eps += `gsave\n`;
                        eps += `${fill.r.toFixed(4)} ${fill.g.toFixed(4)} ${fill.b.toFixed(4)} setrgbcolor\n`;
                        eps += `fill\n`;
                        eps += `grestore\n`;
                    }

                    if (stroke) {
                        eps += `${strokeWidth.toFixed(2)} setlinewidth\n`;
                        eps += `${stroke.r.toFixed(4)} ${stroke.g.toFixed(4)} ${stroke.b.toFixed(4)} setrgbcolor\n`;
                        eps += `stroke\n`;
                    }

                    eps += `\n`;
                }
            });

            eps += `grestore
showpage

%%EOF`;

            return eps;
        }
    }

    // Generate EPS10 from SVG file
    async function generateAdobeStockEPS10(svgFile) {
        try {
            const text = await svgFile.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'image/svg+xml');

            const svg = doc.documentElement;
            const generator = new AdobeStockEpsGenerator(svg);
            const epsContent = generator.generate();

            return new Blob([epsContent], { type: 'application/postscript' });
        } catch (error) {
            console.error('Error generating EPS10:', error);
            throw error;
        }
    }

    // Download EPS10 file
    async function downloadAsEPS10(svgFile, filename) {
        try {
            const epsBlob = await generateAdobeStockEPS10(svgFile);
            const url = URL.createObjectURL(epsBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename.replace(/\.svg$/i, '') + '.eps';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (error) {
            alert('Error generating EPS file: ' + error.message);
        }
    }
    // ==========================================
    // EPS10 CONVERSION LOGIC (Client-Side)
    // ==========================================

    window.EpsConverter = class EpsConverter {
        constructor(svgString, metadata) {
            this.parser = new DOMParser();
            this.doc = this.parser.parseFromString(svgString, "image/svg+xml");
            this.metadata = metadata;
            this.psCode = [];
            this.width = 0;
            this.height = 0;
            this.boundingBox = [0, 0, 0, 0];
            this.extractCSS(this.doc);
        }

        extractCSS(doc) {
            this.cssRules = {};
            const styleNodes = doc.getElementsByTagName("style");
            for (let i = 0; i < styleNodes.length; i++) {
                const cssText = styleNodes[i].textContent;
                const blockRegex = /([^{]+)\s*\{\s*([^}]+)\s*\}/g;
                let match;
                while ((match = blockRegex.exec(cssText)) !== null) {
                    const selectors = match[1].split(',').map(s => s.trim());
                    const rulesStr = match[2];

                    const rules = {};
                    rulesStr.split(';').forEach(rule => {
                        const parts = rule.split(':');
                        if (parts.length === 2) {
                            rules[parts[0].trim().toLowerCase()] = parts[1].trim();
                        }
                    });

                    selectors.forEach(selector => {
                        if (selector.startsWith('.')) {
                            const className = selector.substring(1);
                            if (!this.cssRules[className]) this.cssRules[className] = {};
                            Object.assign(this.cssRules[className], rules);
                        }
                    });
                }
            }
        }

        convert() {
            const svg = this.doc.documentElement;
            this.width = parseFloat(svg.getAttribute("width")) || 500;
            this.height = parseFloat(svg.getAttribute("height")) || 500;

            // ViewBox parsing for better scaling if needed, defaulting to width/height
            const viewBox = svg.getAttribute("viewBox");
            if (viewBox) {
                const vb = viewBox.split(/[\s,]+/).map(parseFloat);
                if (vb.length === 4) {
                    // We use the viewbox to set bounds
                    this.width = vb[2];
                    this.height = vb[3];
                }
            }

            // CRITICAL: EPS Header must be first
            this.psCode.push("%!PS-Adobe-3.0 EPSF-3.0");
            this.psCode.push(`%%BoundingBox: 0 0 ${Math.ceil(this.width)} ${Math.ceil(this.height)}`);
            this.psCode.push(`%%HiResBoundingBox: 0 0 ${this.width} ${this.height}`);
            this.psCode.push(`%%Creator: MetaGen Pro`);
            this.psCode.push(`%%Title: ${this.metadata.title || 'Untitled'}`);
            this.psCode.push(`%%CreationDate: ${new Date().toISOString()}`);
            this.psCode.push("%%EndComments");

            // Generate Definitions/Macros after header
            this.generateHeader();

            // Metadata injection
            this.injectMetadata();

            // Setup coordinate system: SVG (Top-Left) -> EPS (Bottom-Left)
            this.psCode.push("gsave");
            this.psCode.push(`0 ${this.height} translate`); // Move origin to top-left of page area
            this.psCode.push(`1 -1 scale`); // Flip Y axis to match SVG

            // Recursive processing
            this.processNode(svg);

            this.psCode.push("grestore");
            this.psCode.push("showpage"); // Standard EPS finisher
            this.psCode.push("%%EOF");

            return this.psCode.join("\n");
        }

        generateHeader() {
            // Standard dictionary setup
            this.psCode.push("/m {moveto} bind def");
            this.psCode.push("/l {lineto} bind def");
            this.psCode.push("/c {curveto} bind def");
            this.psCode.push("/z {closepath} bind def");
            this.psCode.push("/f {fill} bind def");
            this.psCode.push("/s {stroke} bind def");
            this.psCode.push("/rgb {setrgbcolor} bind def");
            this.psCode.push("/w {setlinewidth} bind def");
        }

        injectMetadata() {
            if (!this.metadata) return;

            const title = escapeXml(this.metadata.title || "");
            const description = escapeXml(this.metadata.description || "");
            const keywords = (this.metadata.keywords || "").split(',').map(k => k.trim()).filter(Boolean);
            const keywordsRdf = keywords.map(k => `<rdf:li>${escapeXml(k)}</rdf:li>`).join('\n');

            // Adobe XMP Standard Header/Footer
            const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.6-c138 79.159824, 2016/09/14-01:09:01">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <dc:format>application/postscript</dc:format>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${title}</rdf:li></rdf:Alt></dc:title>
   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${description}</rdf:li></rdf:Alt></dc:description>
   <dc:subject><rdf:Bag>${keywordsRdf}</rdf:Bag></dc:subject>
   <photoshop:Headline>${title}</photoshop:Headline>
   <photoshop:Description>${description}</photoshop:Description>
   <xmp:CreatorTool>MetaGen Pro</xmp:CreatorTool>
   <xmp:CreateDate>${new Date().toISOString()}</xmp:CreateDate>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

            // Break XMP into 255-byte chunks for EPS compatibility (standard generic EPS comment injection)
            // Simplified approach: Put it in a %XML_PACKET comments block or just standard % comments
            // For valid EPS XMP, it's often embedded in a specific way, but standard comments are safer for a simple converter.
            // However, to be read by Illustrator "File Info", it needs to be valid RDF in the file stream.
            // We will dump it as a block of comments.

            this.psCode.push("%begin_xml_packet: 1");
            const lines = xmp.split('\n');
            lines.forEach(line => this.psCode.push("% " + line));
            this.psCode.push("%end_xml_packet");
        }

        getStyle(node, prop, stylesObj) {
            // Priority:
            // 1. Attribute directly on element (e.g. fill="red")
            // 2. Inline style attribute (e.g. style="fill:red") - parsed into stylesObj
            // 3. CSS Classes applied to node
            // 4. Default

            if (node.hasAttribute(prop)) return node.getAttribute(prop);
            if (stylesObj && stylesObj[prop]) return stylesObj[prop];

            const classNames = (node.getAttribute("class") || "").split(/\s+/);
            for (const cls of classNames) {
                if (this.cssRules && this.cssRules[cls] && this.cssRules[cls][prop]) {
                    return this.cssRules[cls][prop];
                }
            }

            return null;
        }

        parseStyleAttribute(node) {
            const styleStr = node.getAttribute("style");
            if (!styleStr) return {};
            const styles = {};
            styleStr.split(';').forEach(eqn => {
                const [key, val] = eqn.split(':');
                if (key && val) styles[key.trim().toLowerCase()] = val.trim();
            });
            return styles;
        }

        processNode(node) {
            if (node.nodeType !== 1) return; // Process only elements
            const tagName = node.tagName.toLowerCase();

            // SKIP definitions - they are only used when referenced
            if (['defs', 'symbol', 'clipPath', 'mask', 'pattern', 'marker'].includes(tagName)) return;

            this.psCode.push("gsave");

            // Handle 'use' tag specifically
            if (tagName === 'use') {
                this.processUse(node);
                this.psCode.push("grestore");
                return;
            }

            // Apply Transforms
            const transform = node.getAttribute("transform");
            if (transform) {
                this.applyTransform(transform);
            }

            // Parse Styles
            const stylesObj = this.parseStyleAttribute(node);

            // Apply Styles (Fill/Stroke)
            let fill = this.getStyle(node, 'fill', stylesObj);
            let stroke = this.getStyle(node, 'stroke', stylesObj);
            let strokeWidth = this.getStyle(node, 'stroke-width', stylesObj) || 1;

            // Defaults
            // If fill is not specified, SVG default is BLACK. 
            // However, for lines/polylines without fill, we might not want black.
            // But standard says: fill=black unless 'none'.
            // We will respect this unless it's a line? No, line with fill black is invisible if valid.

            if (!fill && !stroke) {
                // If nothing specified, SVG default is black fill, no stroke.
                if (['path', 'rect', 'circle', 'ellipse', 'polygon'].includes(tagName)) {
                    fill = '#000000';
                }
            }

            // Parse Colors
            let hasFill = (fill && fill.toLowerCase() !== "none");
            let hasStroke = (stroke && stroke.toLowerCase() !== "none");

            // Process Geometry
            let pathData = "";

            switch (tagName) {
                case "g":
                case "svg":
                case "a":
                    Array.from(node.children).forEach(child => this.processNode(child));
                    break;

                case "path":
                    pathData = node.getAttribute("d");
                    if (pathData) this.drawPath(pathData);
                    break;

                case "rect":
                    const x = parseFloat(node.getAttribute("x")) || 0;
                    const y = parseFloat(node.getAttribute("y")) || 0;
                    const w = parseFloat(node.getAttribute("width")) || 0;
                    const h = parseFloat(node.getAttribute("height")) || 0;
                    this.drawRect(x, y, w, h);
                    break;

                case "circle":
                    const cx = parseFloat(node.getAttribute("cx")) || 0;
                    const cy = parseFloat(node.getAttribute("cy")) || 0;
                    const r = parseFloat(node.getAttribute("r")) || 0;
                    this.drawCircle(cx, cy, r);
                    break;

                case "ellipse":
                    const ex = parseFloat(node.getAttribute("cx")) || 0;
                    const ey = parseFloat(node.getAttribute("cy")) || 0;
                    const rx = parseFloat(node.getAttribute("rx")) || 0;
                    const ry = parseFloat(node.getAttribute("ry")) || 0;
                    this.drawEllipse(ex, ey, rx, ry);
                    break;

                case "line":
                    const x1 = parseFloat(node.getAttribute("x1")) || 0;
                    const y1 = parseFloat(node.getAttribute("y1")) || 0;
                    const x2 = parseFloat(node.getAttribute("x2")) || 0;
                    const y2 = parseFloat(node.getAttribute("y2")) || 0;
                    this.drawLine(x1, y1, x2, y2);
                    break;

                case "polyline":
                case "polygon":
                    const points = node.getAttribute("points");
                    if (points) this.drawPoly(points, tagName === "polygon");
                    break;
            }

            // Apply Stroke/Fill Ops if path was generated
            if (["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"].includes(tagName)) {
                if (hasFill) {
                    this.setColor(fill);
                    if (hasStroke) {
                        this.psCode.push("gsave f grestore"); // fill then keep path for stroke
                    } else {
                        this.psCode.push("f");
                    }
                }

                if (hasStroke) {
                    this.setColor(stroke);
                    this.psCode.push(`${parseFloat(strokeWidth)} w`);
                    this.psCode.push("s");
                }

                // Clean up path if neither (rare, but good for safety)
                if (!hasFill && !hasStroke) {
                    this.psCode.push("newpath");
                }
            }

            this.psCode.push("grestore");
        }

        processUse(node) {
            const href = node.getAttribute("href") || node.getAttribute("xlink:href");
            if (!href || !href.startsWith('#')) return;

            const id = href.substring(1);
            // Use getElementById on document? 
            // Note: 'this.doc' is the parser document.
            const refNode = this.doc.getElementById(id);
            if (!refNode) return;

            // Apply 'use' specific transforms (x, y)
            const x = parseFloat(node.getAttribute("x")) || 0;
            const y = parseFloat(node.getAttribute("y")) || 0;
            if (x !== 0 || y !== 0) {
                this.psCode.push(`${x} ${y} translate`);
            }

            // Process the referenced node
            // Note: 'use' can reference a 'symbol' or 'g' or shape.
            // If it's a symbol, we might need to handle viewBox? 
            // For now, treat as direct inclusion.

            // We need to clone it to avoid mutating original if needed? No, treating read-only.
            // But we MUST NOT process its ID again if recursive? 
            // Just call processNode on it.

            // IMPORTANT: 'use' elements can override styles?
            // "CSS properties that are inherited are inherited from the 'use' element"
            // We ignored inheritance above. Complex.
            // We'll just process the referenced node geometry. 
            this.processNode(refNode);
        }

        applyTransform(transformStr) {
            // Basic parser for "translate(x,y)", "scale(s)", "rotate(a)"
            // Real implementation needs full matrix multiplication support or use a library.
            // For stock, simpler SVGs usually rely on groups.
            // We will map SVG transform syntax to PostScript concat.

            // Regex match all transforms
            const regex = /(\w+)\(([^)]+)\)/g;
            let match;
            while ((match = regex.exec(transformStr)) !== null) {
                const type = match[1];
                const args = match[2].split(/[\s,]+/).map(parseFloat);

                if (type === "translate") {
                    this.psCode.push(`${args[0]} ${args[1] || 0} translate`);
                } else if (type === "scale") {
                    this.psCode.push(`${args[0]} ${args[1] || args[0]} scale`);
                } else if (type === "rotate") {
                    // SVG rotate is degrees around origin (or optional cx,cy)
                    // PS rotate is degrees
                    if (args.length === 1) {
                        this.psCode.push(`${args[0]} rotate`);
                    } else if (args.length === 3) {
                        // Rotate around point: translate(cx,cy) rotate(a) translate(-cx,-cy)
                        this.psCode.push(`${args[1]} ${args[2]} translate`);
                        this.psCode.push(`${args[0]} rotate`);
                        this.psCode.push(`${-args[1]} ${-args[2]} translate`);
                    }
                } else if (type === "matrix") {
                    // SVG: matrix(a b c d e f)
                    // PS: [a b c d e f] concat
                    if (args.length === 6) {
                        this.psCode.push(`[${args[0]} ${args[1]} ${args[2]} ${args[3]} ${args[4]} ${args[5]}] concat`);
                    }
                }
            }
        }

        drawPath(d) {
            // Tokenize path data
            const tokens = d.match(/([a-zA-Z])|([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/g);
            if (!tokens) return;

            this.psCode.push("newpath");

            let cx = 0, cy = 0; // Current position
            let startX = 0, startY = 0; // Start of current subpath
            let lastControlX = 0, lastControlY = 0; // For smooth curves (S, T)
            let lastCmd = ''; // Track previous command for S/T control point reflection

            let idx = 0;
            while (idx < tokens.length) {
                let cmd = tokens[idx++];

                // If token is a number, assume implicit repetition of the last command
                if (!/[a-zA-Z]/.test(cmd)) {
                    // Implicit commands are tricky. Usually, if a command expects args and we get more numbers, 
                    // it repeats. E.g., L 10 10 20 20 is L 10 10 then L 20 20.
                    // For 'M', subsequent pairs are treated as 'L'.
                    idx--; // Push back current token
                    if (lastCmd === 'M') cmd = 'L';
                    else if (lastCmd === 'm') cmd = 'l';
                    else cmd = lastCmd;
                }

                lastCmd = cmd;
                const upperCmd = cmd.toUpperCase();
                const isRel = (cmd === cmd.toLowerCase());

                // Helper to get numbers
                const getNums = (n) => {
                    const nums = [];
                    for (let i = 0; i < n; i++) {
                        let val = parseFloat(tokens[idx++]);
                        if (isNaN(val)) val = 0;
                        nums.push(val);
                    }
                    return nums;
                };

                switch (upperCmd) {
                    case 'M': {
                        const [x, y] = getNums(2);
                        cx = isRel ? cx + x : x;
                        cy = isRel ? cy + y : y;
                        startX = cx; startY = cy;
                        this.psCode.push(`${cx.toFixed(3)} ${cy.toFixed(3)} m`);
                        lastControlX = cx; lastControlY = cy;
                        break;
                    }
                    case 'L': {
                        const [x, y] = getNums(2);
                        cx = isRel ? cx + x : x;
                        cy = isRel ? cy + y : y;
                        this.psCode.push(`${cx.toFixed(3)} ${cy.toFixed(3)} l`);
                        lastControlX = cx; lastControlY = cy;
                        break;
                    }
                    case 'H': {
                        const [x] = getNums(1);
                        cx = isRel ? cx + x : x;
                        this.psCode.push(`${cx.toFixed(3)} ${cy.toFixed(3)} l`);
                        lastControlX = cx; lastControlY = cy;
                        break;
                    }
                    case 'V': {
                        const [y] = getNums(1);
                        cy = isRel ? cy + y : y;
                        this.psCode.push(`${cx.toFixed(3)} ${cy.toFixed(3)} l`);
                        lastControlX = cx; lastControlY = cy;
                        break;
                    }
                    case 'C': {
                        const [x1, y1, x2, y2, x, y] = getNums(6);
                        const absX1 = isRel ? cx + x1 : x1;
                        const absY1 = isRel ? cy + y1 : y1;
                        const absX2 = isRel ? cx + x2 : x2;
                        const absY2 = isRel ? cy + y2 : y2;
                        cx = isRel ? cx + x : x;
                        cy = isRel ? cy + y : y;
                        this.psCode.push(`${absX1.toFixed(3)} ${absY1.toFixed(3)} ${absX2.toFixed(3)} ${absY2.toFixed(3)} ${cx.toFixed(3)} ${cy.toFixed(3)} c`);
                        lastControlX = absX2; lastControlY = absY2;
                        break;
                    }
                    case 'S': {
                        // Smooth cubic: first control point is reflection of last second control point
                        const [x2, y2, x, y] = getNums(4);
                        // Reflection logic
                        let absX1 = cx, absY1 = cy;
                        if (['C', 'S'].includes(lastCmd.toUpperCase())) {
                            absX1 = 2 * cx - lastControlX;
                            absY1 = 2 * cy - lastControlY;
                        }

                        const absX2 = isRel ? cx + x2 : x2;
                        const absY2 = isRel ? cy + y2 : y2;
                        cx = isRel ? cx + x : x;
                        cy = isRel ? cy + y : y;

                        this.psCode.push(`${absX1.toFixed(3)} ${absY1.toFixed(3)} ${absX2.toFixed(3)} ${absY2.toFixed(3)} ${cx.toFixed(3)} ${cy.toFixed(3)} c`);
                        lastControlX = absX2; lastControlY = absY2;
                        break;
                    }
                    case 'Q': {
                        // Quadratic bezier: convert to cubic
                        // Q x1 y1 x y
                        const [x1, y1, x, y] = getNums(4);
                        const absX1 = isRel ? cx + x1 : x1;
                        const absY1 = isRel ? cy + y1 : y1;
                        const absX = isRel ? cx + x : x;
                        const absY = isRel ? cy + y : y;

                        // Degree elevation from quadratic to cubic
                        // CP1 = current + 2/3 * (Q_CP - current)
                        // CP2 = end + 2/3 * (Q_CP - end)
                        const cp1x = cx + (2 / 3) * (absX1 - cx);
                        const cp1y = cy + (2 / 3) * (absY1 - cy);
                        const cp2x = absX + (2 / 3) * (absX1 - absX);
                        const cp2y = absY + (2 / 3) * (absY1 - absY);

                        cx = absX; cy = absY;
                        this.psCode.push(`${cp1x.toFixed(3)} ${cp1y.toFixed(3)} ${cp2x.toFixed(3)} ${cp2y.toFixed(3)} ${cx.toFixed(3)} ${cy.toFixed(3)} c`);
                        lastControlX = absX1; lastControlY = absY1;
                        break;
                    }
                    case 'T': {
                        // Smooth quadratic: reflect previous control point
                        const [x, y] = getNums(2);
                        let absX1 = cx, absY1 = cy;

                        if (['Q', 'T'].includes(lastCmd.toUpperCase())) {
                            absX1 = 2 * cx - lastControlX;
                            absY1 = 2 * cy - lastControlY;
                        }

                        const absX = isRel ? cx + x : x;
                        const absY = isRel ? cy + y : y;

                        // Convert inferred Q control point (absX1, absY1) to C control points
                        const cp1x = cx + (2 / 3) * (absX1 - cx);
                        const cp1y = cy + (2 / 3) * (absY1 - cy);
                        const cp2x = absX + (2 / 3) * (absX1 - absX);
                        const cp2y = absY + (2 / 3) * (absY1 - absY);

                        cx = absX; cy = absY;
                        this.psCode.push(`${cp1x.toFixed(3)} ${cp1y.toFixed(3)} ${cp2x.toFixed(3)} ${cp2y.toFixed(3)} ${cx.toFixed(3)} ${cy.toFixed(3)} c`);
                        lastControlX = absX1; lastControlY = absY1;
                        break;
                    }
                    case 'A': {
                        // Arc: Hard to implement fully. Approximating with a straight line for MVP robustness.
                        // A rx ry x-axis-rotation large-arc-flag sweep-flag x y
                        const [rx, ry, rot, large, sweep, x, y] = getNums(7);
                        cx = isRel ? cx + x : x;
                        cy = isRel ? cy + y : y;
                        // Fallback: Draw line to end point
                        this.psCode.push(`${cx.toFixed(3)} ${cy.toFixed(3)} l`);
                        lastControlX = cx; lastControlY = cy;
                        break;
                    }
                    case 'Z': {
                        this.psCode.push("z");
                        cx = startX; cy = startY; // Close path returns to start
                        lastControlX = cx; lastControlY = cy;
                        break;
                    }
                    default:
                        break;
                }
            }
        }

        drawRect(x, y, w, h) {
            this.psCode.push("newpath");
            this.psCode.push(`${x} ${y} m`);
            this.psCode.push(`${x + w} ${y} l`);
            this.psCode.push(`${x + w} ${y + h} l`);
            this.psCode.push(`${x} ${y + h} l`);
            this.psCode.push("z");
        }

        drawCircle(cx, cy, r) {
            // Constant for circle approximation with Beziers
            const k = 0.55228475;
            this.psCode.push("newpath");
            this.psCode.push(`${(cx + r).toFixed(3)} ${cy.toFixed(3)} m`);
            this.psCode.push(`${(cx + r).toFixed(3)} ${(cy + k * r).toFixed(3)} ${(cx + k * r).toFixed(3)} ${(cy + r).toFixed(3)} ${cx.toFixed(3)} ${(cy + r).toFixed(3)} c`);
            this.psCode.push(`${(cx - k * r).toFixed(3)} ${(cy + r).toFixed(3)} ${(cx - r).toFixed(3)} ${(cy + k * r).toFixed(3)} ${(cx - r).toFixed(3)} ${cy.toFixed(3)} c`);
            this.psCode.push(`${(cx - r).toFixed(3)} ${(cy - k * r).toFixed(3)} ${(cx - k * r).toFixed(3)} ${(cy - r).toFixed(3)} ${cx.toFixed(3)} ${(cy - r).toFixed(3)} c`);
            this.psCode.push(`${(cx + k * r).toFixed(3)} ${(cy - r).toFixed(3)} ${(cx + r).toFixed(3)} ${(cy - k * r).toFixed(3)} ${(cx + r).toFixed(3)} ${cy.toFixed(3)} c`);
            this.psCode.push("z");
        }

        drawEllipse(cx, cy, rx, ry) {
            // Same as circle but with separate radii
            const k = 0.552284749831;
            this.psCode.push("newpath");
            this.psCode.push(`${cx + rx} ${cy} m`);
            this.psCode.push(`${cx + rx} ${cy + k * ry} ${cx + k * rx} ${cy + ry} ${cx} ${cy + ry} c`);
            this.psCode.push(`${cx - k * rx} ${cy + ry} ${cx - rx} ${cy + k * ry} ${cx - rx} ${cy} c`);
            this.psCode.push(`${cx - rx} ${cy - k * ry} ${cx - k * rx} ${cy - ry} ${cx} ${cy - ry} c`);
            this.psCode.push(`${cx + k * rx} ${cy - ry} ${cx + rx} ${cy - k * ry} ${cx + rx} ${cy} c`);
            this.psCode.push("z");
        }

        drawLine(x1, y1, x2, y2) {
            this.psCode.push("newpath");
            this.psCode.push(`${x1} ${y1} m`);
            this.psCode.push(`${x2} ${y2} l`);
        }

        drawPoly(pointsStr, isClosed) {
            const pts = pointsStr.trim().split(/[\s,]+/).map(parseFloat);
            if (pts.length < 2) return;

            this.psCode.push("newpath");
            this.psCode.push(`${pts[0]} ${pts[1]} m`);
            for (let i = 2; i < pts.length; i += 2) {
                this.psCode.push(`${pts[i]} ${pts[i + 1]} l`);
            }
            if (isClosed) this.psCode.push("z");
        }

        setColor(colorStr) {
            if (!colorStr) return;

            const colors = {
                'white': '1 1 1',
                'black': '0 0 0',
                'red': '1 0 0',
                'green': '0 1 0',
                'blue': '0 0 1',
                'yellow': '1 1 0',
                'cyan': '0 1 1',
                'magenta': '1 0 1',
                'gray': '0.5 0.5 0.5',
                'grey': '0.5 0.5 0.5',
                'orange': '1 0.5 0',
                'purple': '0.5 0 0.5'
            };

            const c = colorStr.toLowerCase();

            // Handle Hex
            if (c.startsWith('#')) {
                let hex = c.substring(1);
                if (hex.length === 3) hex = hex.split('').map(char => char + char).join('');
                const r = parseInt(hex.substring(0, 2), 16) / 255;
                const g = parseInt(hex.substring(2, 4), 16) / 255;
                const b = parseInt(hex.substring(4, 6), 16) / 255;
                if (!isNaN(r)) this.psCode.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rgb`);
            }
            // Handle rgb()
            else if (c.startsWith('rgb')) {
                const vals = c.match(/\d+/g);
                if (vals && vals.length >= 3) {
                    this.psCode.push(`${(vals[0] / 255).toFixed(3)} ${(vals[1] / 255).toFixed(3)} ${(vals[2] / 255).toFixed(3)} rgb`);
                }
            }
            // Handle Named Colors
            else if (colors[c]) {
                this.psCode.push(`${colors[c]} rgb`);
            }
            // Default fallback
            else {
                this.psCode.push("0 0 0 rgb");
            }
        }
    }
    // Helper to get EPS Blob from Server
    window.getEpsBlobForFile = async function (fileData) {
        const card = document.getElementById(fileData.id);
        let currentTitle = fileData.title || '';
        let currentDesc = fileData.description || '';
        let currentKeywords = fileData.keywords || '';

        if (card) {
            const titleEl = card.querySelector('.meta-title');
            if (titleEl) currentTitle = titleEl.innerText.trim();
            const descEl = card.querySelector('.meta-description');
            if (descEl) currentDesc = descEl.innerText.trim();
            const keywordsEl = card.querySelector('.meta-keywords');
            if (keywordsEl) {
                const pills = Array.from(keywordsEl.querySelectorAll('.meta-keyword-pill'));
                if (pills.length > 0) {
                    currentKeywords = pills.map(pill => {
                        const clone = pill.cloneNode(true);
                        const badge = clone.querySelector('.demand-badge'); if (badge) badge.remove();
                        const removeBtn = clone.querySelector('.keyword-remove-btn'); if (removeBtn) removeBtn.remove();
                        const scoreSpan = clone.querySelector('.keyword-score'); if (scoreSpan) scoreSpan.remove();
                        return clone.textContent.trim();
                    }).filter(t => t).join(', ');
                }
            }
        }

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const svgContent = e.target.result;
                    const metadata = {
                        title: currentTitle,
                        description: currentDesc,
                        keywords: currentKeywords
                    };

                    // Run EpsConverter directly on the main thread
                    // which automatically utilizes the browser's native DOMParser
                    const converter = new EpsConverter(svgContent, metadata);
                    const epsString = converter.convert();
                    const blob = new Blob([epsString], { type: 'application/postscript' });
                    resolve(blob);
                } catch (error) {
                    reject(new Error("Local EPS conversion failed: " + error.message));
                }
            };

            reader.onerror = () => reject(new Error("File read error"));
            reader.readAsText(fileData.fileObject);
        });
    }

    // --- Individual EPS Download ---
    window.downloadAsEps = async function (idOrData) {
        let fileData = idOrData;
        if (typeof idOrData === 'string') {
            fileData = uploadedFilesData.find(f => f.id === idOrData);
        }

        if (!fileData) {
            console.error("File data not found for download.");
            return;
        }

        const button = document.getElementById(`btn-eps-${fileData.id}`);
        const originalText = button ? button.innerHTML : '';
        if (button) {
            button.disabled = true;
            button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Converting...';
        }

        try {
            const blob = await getEpsBlobForFile(fileData);
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = fileData.name.replace(/(\.svg)$/i, '_meta.eps');
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error("EPS Download Error:", error);
            alert("Failed to generate EPS: " + error.message);
        } finally {
            if (button) {
                button.disabled = false;
                button.innerHTML = originalText;
            }
        }
    }


    // --- Batch Download All EPS (ZIP Packaging - Premium Only) ---
    // Uses In-line Web Worker for non-blocking ZIP generation
    window.downloadAllEps = async function () {
        const isPremium = window.userUsageData?.plan === 'premium';
        if (!isPremium) {
            alert('Batch EPS Download is available for Premium users only.');
            return;
        }

        const svgFiles = uploadedFilesData.filter(f => {
            const isSvg = f.fileObject?.type === 'image/svg+xml' || f.name?.toLowerCase().endsWith('.svg');
            const card = document.getElementById(f.id);
            const hasMetadata = card && card.classList.contains('metadata-generated');
            return isSvg && hasMetadata;
        });

        if (svgFiles.length === 0) {
            alert('No SVG files with generated metadata found for EPS download.');
            return;
        }

        const batchBtn = document.getElementById('batchDownloadEpsButton');
        const originalText = batchBtn ? batchBtn.innerHTML : '';
        if (batchBtn) {
            batchBtn.disabled = true;
        }

        try {
            const zipFilesArray = [];
            let successCount = 0;
            let failCount = 0;

            for (let i = 0; i < svgFiles.length; i++) {
                if (batchBtn) {
                    batchBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Converting ${i + 1}/${svgFiles.length}...`;
                }
                try {
                    const blob = await getEpsBlobForFile(svgFiles[i]);
                    const filename = svgFiles[i].name.replace('.svg', '.eps');
                    // Convert blob to ArrayBuffer for transferring to worker
                    const arrayBuffer = await blob.arrayBuffer();
                    zipFilesArray.push({ filename, data: arrayBuffer });
                    successCount++;
                } catch (err) {
                    console.error(`EPS conversion failed for ${svgFiles[i].name}:`, err);
                    failCount++;
                }
            }

            if (successCount > 0) {
                if (batchBtn) batchBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Packaging ZIP...`;

                // In-line Web Worker for ZIP generation
                const zipWorkerCode = `
                            importScripts('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
                            self.onmessage = async function(e) {
                                try {
                                    const files = e.data.files;
                                    const zip = new JSZip();
                                    for (const file of files) {
                                        zip.file(file.filename, file.data);
                                    }
                                    const content = await zip.generateAsync(
                                        { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
                                        function(meta) {
                                            self.postMessage({ type: 'progress', percent: meta.percent });
                                        }
                                    );
                                    self.postMessage({ type: 'success', blob: content });
                                } catch (err) {
                                    self.postMessage({ type: 'error', error: err.message });
                                }
                            };
                        `;
                const zipWorkerBlob = new Blob([zipWorkerCode], { type: 'application/javascript' });
                const zipWorkerUrl = URL.createObjectURL(zipWorkerBlob);

                await new Promise((resolve, reject) => {
                    const worker = new Worker(zipWorkerUrl);
                    worker.onmessage = (e) => {
                        const { type, percent, blob, error } = e.data;
                        if (type === 'progress') {
                            if (batchBtn) batchBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Packaging ZIP... ${Math.round(percent)}%`;
                        } else if (type === 'success') {
                            const url = URL.createObjectURL(blob);
                            const link = document.createElement("a");
                            link.href = url;
                            link.download = `MetaGen_EPS_Batch_${new Date().getTime()}.zip`;
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                            URL.revokeObjectURL(url);
                            worker.terminate();
                            URL.revokeObjectURL(zipWorkerUrl);
                            resolve();
                        } else if (type === 'error') {
                            worker.terminate();
                            URL.revokeObjectURL(zipWorkerUrl);
                            reject(new Error(error));
                        }
                    };

                    worker.onerror = (err) => {
                        worker.terminate();
                        URL.revokeObjectURL(zipWorkerUrl);
                        reject(err);
                    };

                    // Transfer ArrayBuffers for zero-copy performance
                    const transferables = zipFilesArray.map(f => f.data);
                    worker.postMessage({ action: 'generateZip', files: zipFilesArray }, transferables);
                });
            }


            if (failCount > 0) {
                alert(`Batch Complete: ${successCount} succeeded, ${failCount} failed.`);
            }

        } catch (error) {
            console.error("Batch EPS Error:", error);
            alert("An error occurred during batch process: " + error.message);
        } finally {
            if (batchBtn) {
                batchBtn.disabled = false;
                batchBtn.innerHTML = originalText;
            }
        }
    }

    window.checkBatchEpsButtonState = function () {
        const batchEpsBtn = document.getElementById('batchDownloadEpsButton');
        if (!batchEpsBtn) return;

        const isPremium = window.userUsageData?.plan === 'premium';
        if (!isPremium) {
            batchEpsBtn.style.display = 'none';
            batchEpsBtn.disabled = true;
            return;
        }
        // Show button for premium users
        batchEpsBtn.style.display = 'inline-flex';

        const hasSvgWithMeta = uploadedFilesData.some(f => {
            const isSvg = f.fileObject?.type === 'image/svg+xml' || f.name?.toLowerCase().endsWith('.svg');
            const card = document.getElementById(f.id);
            return isSvg && card && card.classList.contains('metadata-generated');
        });

        batchEpsBtn.disabled = !hasSvgWithMeta;
    }

    window.embedSvgAndDownload = async function (fileData) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const svgContent = e.target.result;
                    const parser = new DOMParser();
                    const xmlDoc = parser.parseFromString(svgContent, "image/svg+xml");

                    const svgRoot = xmlDoc.documentElement;

                    let titleNode = svgRoot.querySelector("title");
                    if (!titleNode) {
                        titleNode = xmlDoc.createElementNS("http://www.w3.org/2000/svg", "title");
                        svgRoot.insertBefore(titleNode, svgRoot.firstChild);
                    }
                    titleNode.textContent = fileData.title || "";

                    let descNode = svgRoot.querySelector("desc");
                    if (!descNode) {
                        descNode = xmlDoc.createElementNS("http://www.w3.org/2000/svg", "desc");
                        svgRoot.insertBefore(descNode, titleNode.nextSibling);
                    }
                    descNode.textContent = fileData.description || "";

                    const oldMetadata = svgRoot.querySelectorAll("metadata");
                    oldMetadata.forEach(el => el.remove());

                    let metadataNode = xmlDoc.createElementNS("http://www.w3.org/2000/svg", "metadata");
                    metadataNode.id = "metagen-placeholder";
                    svgRoot.insertBefore(metadataNode, descNode.nextSibling);

                    const serializer = new XMLSerializer();
                    let svgString = serializer.serializeToString(xmlDoc);

                    const title = escapeXml(fileData.title || "");
                    const description = escapeXml(fileData.description || "");
                    const keywordsArray = (fileData.keywords || "").split(',').map(k => k.trim()).filter(Boolean);
                    const keywordsRdf = keywordsArray.map(k => `<rdf:li>${escapeXml(k)}</rdf:li>`).join('\n                                    ');

                    const xmpContent = `
        <x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.6-c138 79.159824, 2016/09/14-01:09:01        ">
            <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
                <rdf:Description rdf:about=""
                    xmlns:dc="http://purl.org/dc/elements/1.1/"
                    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
                    xmlns:xmp="http://ns.adobe.com/xap/1.0/">
                    <dc:format>image/svg+xml</dc:format>
                    <dc:title>
                        <rdf:Alt>
                            <rdf:li xml:lang="x-default">${title}</rdf:li>
                        </rdf:Alt>
                    </dc:title>
                    <dc:description>
                        <rdf:Alt>
                            <rdf:li xml:lang="x-default">${description}</rdf:li>
                        </rdf:Alt>
                    </dc:description>
                    <dc:subject>
                        <rdf:Bag>
                            ${keywordsRdf}
                        </rdf:Bag>
                    </dc:subject>
                    <photoshop:Headline>${title}</photoshop:Headline>
                    <photoshop:Description>${description}</photoshop:Description>
                    <xmp:CreatorTool>MetaGen Pro</xmp:CreatorTool>
                    <xmp:CreateDate>${new Date().toISOString()}</xmp:CreateDate>
                </rdf:Description>
            </rdf:RDF>
        </x:xmpmeta>`;

                    const xmpWithPacket = `<metadata id="metagen-data"><?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>${xmpContent}<?xpacket end="w"?></metadata>`;

                    svgString = svgString.replace(/<metadata[^>]*id="metagen-placeholder"[^>]*>(.*?)<\/metadata>|<metadata[^>]*id="metagen-placeholder"[^>]*\/>/si, xmpWithPacket);

                    if (!svgString.startsWith('<?xml')) {
                        svgString = '<?xml version="1.0" encoding="utf-8"?>\n' + svgString;
                    }

                    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = fileData.name.replace(/(\.svg)$/i, '_meta$1');
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);

                    resolve();

                } catch (error) {
                    console.error("SVG Embed Error:", error);
                    alert(`Error processing SVG: ${fileData.name}`);
                    reject(error);
                }
            };
            reader.onerror = (err) => reject(err);
            reader.readAsText(fileData.fileObject);
        });
    }
});