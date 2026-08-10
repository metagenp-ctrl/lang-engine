
document.addEventListener('DOMContentLoaded', function () {
    // Show loading state while auth initializes
    showLoadingState();


    // --- NEW: Sidebar Toggle Logic ---
    const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
    const sidebar = document.getElementById('appSidebar');
    const body = document.body;

    sidebarToggleBtn.addEventListener('click', () => {
        // For larger screens, toggle a class on the body
        // For larger screens, toggle a class on the body
        if (window.innerWidth > 768) {
            body.classList.toggle('sidebar-hidden');
        } else {
            // For smaller screens, toggle a 'visible' class on the sidebar for overlay effect
            sidebar.classList.toggle('visible');
        }
    });

    // Hide sidebar on click outside on mobile
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768) {
            if (sidebar.classList.contains('visible') && !sidebar.contains(e.target) && !sidebarToggleBtn.contains(e.target) && !e.target.closest('.sidebar-toggle-btn')) {
                sidebar.classList.remove('visible');
            }
        }
    });


    // Initialize collapsible sections
    const collapsibleHeaders = document.querySelectorAll('.collapsible-header');
    collapsibleHeaders.forEach(header => {
        const content = header.nextElementSibling;
        if (content && content.classList.contains('collapsible-content')) {
            content.style.display = 'none';
            content.style.maxHeight = '0';
            header.classList.remove('open');
        }
        header.addEventListener('click', function () {
            const content = this.nextElementSibling;
            if (content && content.classList.contains('collapsible-content')) {
                this.classList.toggle('open');
                if (this.classList.contains('open')) {
                    content.style.display = 'block';
                    requestAnimationFrame(() => {
                        content.style.maxHeight = content.scrollHeight + 'px';
                    });
                } else {
                    content.style.maxHeight = '0';
                    content.addEventListener('transitionend', function handler() {
                        if (!header.classList.contains('open')) {
                            content.style.display = 'none';
                        }
                        content.removeEventListener('transitionend', handler);
                    });
                }
            }
        });
    });

    // Sliders value update
    const sliders = document.querySelectorAll('.slider-group input[type="range"]');
    sliders.forEach(slider => {
        const valueSpan = document.getElementById(slider.id + 'Value');
        if (valueSpan) {
            slider.addEventListener('input', function () { valueSpan.textContent = this.value; });
        }
    });

    // --- BUTTONS & GLOBALS ---
    const jpgPngButton = document.getElementById('jpgPngUploadButton');
    const jpgPngInput = document.getElementById('jpgPngInput');
    const svgEpsButton = document.getElementById('svgEpsUploadButton');
    const svgEpsInput = document.getElementById('svgEpsInput');
    const videoButton = document.getElementById('videoUploadButton');
    const videoInput = document.getElementById('videoInput');
    const previewContainer = document.getElementById('filePreviewContainer');
    const processAllButton = document.getElementById('processAllButton');
    const processAllPromptsButton = document.getElementById('processAllPromptsButton');
    const exportButton = document.getElementById('exportButton');
    const embedMetadataButton = document.getElementById('embedMetadataButton');
    const clearAllButton = document.getElementById('clearAllButton');
    window.uploadedFilesData = [];



    window.showProUpgradeAlert = function () {
        alert("Upgrade to Pro to unlock SEO Score & Rejection Predictor.");
        if (typeof scrollToPricing === 'function') scrollToPricing();
    };

    // ==========================================
    // VECTOR CHECKLIST ANALYSIS FUNCTIONS
    // ==========================================

    async function analyzeSvgFile(file) {
        try {
            const text = await file.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'image/svg+xml');

            // Check for parsing errors
            const parserError = doc.querySelector('parsererror');
            if (parserError) {
                console.warn('SVG parsing error:', parserError.textContent);
            }

            return {
                noGradientMesh: checkNoGradientMesh(doc, text),
                textOutlined: checkTextOutlined(doc, text),
                noRasterImage: checkNoRasterImage(doc),
                strokeExpanded: checkStrokeExpanded(doc, text),
                transparencyFound: checkTransparency(doc, text)
            };
        } catch (error) {
            console.error('Error analyzing SVG:', error);
            return {
                noGradientMesh: { pass: false, status: 'warning' },
                textOutlined: { pass: false, status: 'warning' },
                noRasterImage: { pass: false, status: 'warning' },
                strokeExpanded: { pass: false, status: 'warning' },
                transparencyFound: { pass: false, status: 'warning' }
            };
        }
    }

    function checkNoGradientMesh(doc, text) {
        // Check for mesh gradients (not widely supported)
        const hasMeshGradient = text.includes('<meshgradient') ||
            text.includes('mesh') ||
            doc.querySelector('meshgradient');
        return {
            pass: !hasMeshGradient,
            status: hasMeshGradient ? 'fail' : 'pass'
        };
    }

    function checkTextOutlined(doc, text) {
        // Check if there are any <text> elements (should be converted to paths)
        const textElements = doc.querySelectorAll('text');
        const hasTextTag = text.includes('<text');

        return {
            pass: textElements.length === 0 && !hasTextTag,
            status: (textElements.length > 0 || hasTextTag) ? 'fail' : 'pass'
        };
    }

    function checkNoRasterImage(doc) {
        // Check for embedded raster images
        const imageElements = doc.querySelectorAll('image');
        const hasRaster = Array.from(imageElements).some(img => {
            const href = img.getAttribute('href') || img.getAttribute('xlink:href') || '';
            return href.includes('data:image') || href.match(/\.(jpg|jpeg|png|gif|webp)$/i);
        });

        return {
            pass: !hasRaster,
            status: hasRaster ? 'fail' : 'pass'
        };
    }

    function checkStrokeExpanded(doc, text) {
        // Check if strokes are expanded to paths (no stroke attributes should remain)
        const elementsWithStroke = doc.querySelectorAll('[stroke]');
        const hasStrokeInStyle = text.includes('stroke:') || text.includes('stroke-width');

        // Allow 'none' strokes
        const hasActiveStroke = Array.from(elementsWithStroke).some(el => {
            const stroke = el.getAttribute('stroke');
            return stroke && stroke !== 'none';
        });

        return {
            pass: !hasActiveStroke && !hasStrokeInStyle,
            status: (hasActiveStroke || hasStrokeInStyle) ? 'warning' : 'pass'
        };
    }

    function checkTransparency(doc, text) {
        // Check for transparency/opacity (can cause issues on some platforms)
        const hasOpacity = text.includes('opacity') ||
            text.includes('fill-opacity') ||
            text.includes('stroke-opacity');
        const opacityElements = doc.querySelectorAll('[opacity], [fill-opacity], [stroke-opacity]');

        return {
            pass: hasOpacity || opacityElements.length > 0,
            status: (hasOpacity || opacityElements.length > 0) ? 'warning' : 'pass'
        };
    }

    function showVectorChecklist(filename, results) {
        const modal = document.getElementById('vectorChecklistModal');
        const filenameDiv = document.getElementById('checklistFilename');
        const resultsDiv = document.getElementById('checklistResults');

        filenameDiv.textContent = filename;

        const checks = [
            { key: 'noGradientMesh', label: 'No gradient mesh', emoji: '🎨' },
            { key: 'textOutlined', label: 'Text outlined', emoji: '📝' },
            { key: 'noRasterImage', label: 'No raster image', emoji: '🖼️' },
            { key: 'strokeExpanded', label: 'Stroke expanded', emoji: '✏️' },
            { key: 'transparencyFound', label: 'Transparency found', emoji: '👁️' }
        ];

        resultsDiv.innerHTML = checks.map(check => {
            const result = results[check.key];
            const icon = result.status === 'pass' ? '✓' :
                result.status === 'warning' ? '⚠' : '✗';
            const statusClass = `check-${result.status}`;

            return `
                        <div class="checklist-item ${statusClass}">
                            <span class="check-icon">${icon}</span>
                            <span class="check-label">${check.emoji} ${check.label}</span>
                        </div>
                    `;
        }).join('');

        modal.style.display = 'flex';
    }

    // Checklist modal event handlers
    let pendingVectorFile = null;
    let pendingVectorFiles = [];

    const checklistContinueBtn = document.getElementById('checklistContinueBtn');
    const checklistCancelBtn = document.getElementById('checklistCancelBtn');
    const vectorChecklistModal = document.getElementById('vectorChecklistModal');

    if (checklistContinueBtn) {
        checklistContinueBtn.onclick = async () => {
            vectorChecklistModal.style.display = 'none';

            // Process all pending vector files from batch
            if (pendingVectorFiles && pendingVectorFiles.length > 0) {
                for (const { file } of pendingVectorFiles) {
                    await processVectorFile(file);
                }
                pendingVectorFiles = [];
            }
            // Fallback for single file (legacy)
            else if (pendingVectorFile) {
                await processVectorFile(pendingVectorFile);
                pendingVectorFile = null;
            }
        };
    }

    if (checklistCancelBtn) {
        checklistCancelBtn.onclick = () => {
            vectorChecklistModal.style.display = 'none';
            pendingVectorFile = null;
            pendingVectorFiles = [];
        };
    }

    // ==========================================
    // ADOBE STOCK EPS10 GENERATOR (CLIENT-SIDE)
    // ==========================================

    class AdobeStockEpsGenerator {
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

    function setupModal(buttonId, modalId, saveButtonId, inputId, storageKey, closeButtonId) {

        const modal = document.getElementById(modalId);
        if (!modal) return;
        const button = document.getElementById(buttonId);
        const saveButton = document.getElementById(saveButtonId);
        const input = document.getElementById(inputId);
        const closeButton = closeButtonId ? document.getElementById(closeButtonId) : modal.querySelector('.close-button');
        if (button) button.onclick = () => {
            if (input) input.value = localStorage.getItem(storageKey) || '';
            modal.style.display = 'flex';
        };
        if (saveButton) saveButton.onclick = () => {
            if (input && input.value.trim()) {
                localStorage.setItem(storageKey, input.value.trim());
                alert('API Key saved successfully!');
                modal.style.display = 'none';
            } else {
                alert('Please enter a valid API key.');
            }
        };
        if (closeButton) closeButton.onclick = () => { modal.style.display = 'none'; };
        window.addEventListener('click', (event) => { if (event.target === modal) modal.style.display = 'none'; });
    }

    setupModal('convertapiKeyButton', 'convertapi-key-modal', 'saveConvertapiKeyButton', 'convertapiKeyInput', 'convertApiKey', null);

    // --- CUSTOM PROMPT TOGGLE ---
    const toggleCustomPrompt = document.getElementById('toggleCustomPrompt');
    const customPromptSection = document.getElementById('customPromptSection');
    if (toggleCustomPrompt && customPromptSection) {
        toggleCustomPrompt.addEventListener('change', function () {
            customPromptSection.style.display = this.checked ? 'block' : 'none';
        });
    }

    // --- [UPDATED] PLATFORM BUTTONS LOGIC (Single Selection) ---
    const platformContainer = document.querySelector('.platform-toggle-group');
    if (platformContainer) {
        const platformButtons = platformContainer.querySelectorAll('.platform-button');
        platformContainer.addEventListener('click', function (e) {
            const clickedButton = e.target.closest('.platform-button');
            if (!clickedButton) return;

            // ১. সব বাটন থেকে active ক্লাস রিমুভ করে ক্লিক করা বাটনে যোগ করা
            platformButtons.forEach(btn => btn.classList.remove('active'));
            clickedButton.classList.add('active');

            const selectedPlatform = clickedButton.dataset.platform;

            // ২. Shutterstock Category প্যানেল কন্ট্রোল (যদি থাকে)
            const sstCatPanel = document.getElementById('shutterstockCategoryPanel');
            if (sstCatPanel) {
                sstCatPanel.style.display = (selectedPlatform === 'shutterstock') ? 'block' : 'none';
            }

            // ৩. রেজাল্ট কার্ডের ভেতরকার Adobe Category সেকশন কন্ট্রোল
            // আমরা রেজাল্ট কার্ডের সেই সেকশনটিতে 'adobe-only-section' ক্লাস ব্যবহার করব
            const allAdobeSections = document.querySelectorAll('.adobe-only-section');
            allAdobeSections.forEach(section => {
                if (selectedPlatform === 'adobe') {
                    section.style.display = 'block'; // Adobe Stock সিলেক্ট করলে দেখাবে
                } else {
                    section.style.display = 'none'; // অন্যথায় লুকাবে
                }
            });

            // ৪. Affiliate CTA — প্ল্যাটফর্ম অনুসারে সাইনআপ রেফারেল দেখানো
            const affCta = document.getElementById('platformAffiliateCta');
            const affText = document.getElementById('affiliateCtaText');
            const affLink = document.getElementById('affiliateCtaLink');
            const affiliateMap = {
                'shutterstock': { text: 'Not a Shutterstock contributor yet? Sign up & start earning up to 40% per download!', url: 'https://submit.shutterstock.com/?ref=YOUR_SHUTTERSTOCK_REF', btn: 'Join Shutterstock →' },
                'adobe': { text: 'Not registered on Adobe Stock? Join as a contributor & earn 33% commission!', url: 'https://contributor.stock.adobe.com/?ref=YOUR_ADOBE_REF', btn: 'Join Adobe Stock →' },
                'vecteezy': { text: 'Want to sell on Vecteezy? Become a contributor & reach millions of buyers!', url: 'https://www.vecteezy.com/contributors?ref=YOUR_VECTEEZY_REF', btn: 'Join Vecteezy →' },
                'pond5': { text: 'Sell your photos & videos on Pond5! Join one of the largest media marketplaces.', url: 'https://www.pond5.com/sell-media?ref=YOUR_POND5_REF', btn: 'Join Pond5 →' },
                '123RF': { text: 'Become a 123RF contributor and monetize your creative work worldwide!', url: 'https://www.123rf.com/contributors/?ref=YOUR_123RF_REF', btn: 'Join 123RF →' },
                'Magnific': { text: 'Start selling on Magnific and reach a growing creative community!', url: 'https://contributor.magnific.com?utm_campaign=pradipcob84&utm_medium=referral-content&utm_source=referral', btn: 'Join Magnific →' }
            };
            if (affCta && affiliateMap[selectedPlatform]) {
                const aff = affiliateMap[selectedPlatform];
                affText.textContent = aff.text;
                affLink.href = aff.url;
                affLink.textContent = aff.btn;
                affCta.style.display = 'flex';
            } else if (affCta) {
                affCta.style.display = 'none';
            }
        });
    }


    // --- FILE UPLOAD BUTTONS ---
    if (jpgPngButton && jpgPngInput) jpgPngButton.onclick = () => jpgPngInput.click();
    if (svgEpsButton && svgEpsInput) svgEpsButton.onclick = () => svgEpsInput.click();
    if (videoButton && videoInput) videoButton.onclick = () => videoInput.click();

    // --- FILE INPUT CHANGE ---
    if (jpgPngInput) jpgPngInput.onchange = (e) => handleFiles(e.target.files);
    if (svgEpsInput) svgEpsInput.onchange = (e) => handleFiles(e.target.files);
    if (videoInput) videoInput.onchange = (e) => handleFiles(e.target.files);

    const folderButton = document.getElementById('folderUploadButton');
    const folderInput = document.getElementById('folderInput');

    if (folderButton && folderInput) {
        folderButton.onclick = () => folderInput.click();
        folderInput.onchange = (e) => handleFiles(e.target.files);
    }

    // --- DRAG & DROP ---
    const dropZone = document.getElementById('dropZone');
    if (dropZone) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => dropZone.addEventListener(eventName, preventDefaults, false));
        function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }
        ['dragenter', 'dragover'].forEach(eventName => dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false));
        ['dragleave', 'drop'].forEach(eventName => dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false));

        async function traverseFileTree(item, path = '') {
            return new Promise((resolve) => {
                if (!item) {
                    resolve([]);
                    return;
                }
                if (item.isFile) {
                    item.file((file) => {
                        // Preserve full path for FTP & processing 
                        file.customPath = path + file.name;
                        resolve([file]);
                    });
                } else if (item.isDirectory) {
                    const dirReader = item.createReader();
                    const entries = [];
                    const readEntries = () => {
                        dirReader.readEntries(async (results) => {
                            if (!results.length) {
                                let allFiles = [];
                                for (const entry of entries) {
                                    const subFiles = await traverseFileTree(entry, path + item.name + "/");
                                    allFiles.push(...subFiles);
                                }
                                resolve(allFiles);
                            } else {
                                entries.push(...results);
                                readEntries();
                            }
                        });
                    };
                    readEntries();
                } else {
                    resolve([]);
                }
            });
        }

        dropZone.addEventListener('drop', async (event) => {
            if (event.dataTransfer && event.dataTransfer.items) {
                const items = event.dataTransfer.items;
                let allFiles = [];
                const promises = [];
                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
                    if (entry) {
                        promises.push(traverseFileTree(entry));
                    } else if (item.kind === 'file') {
                        const file = item.getAsFile();
                        if (file) {
                            file.customPath = file.name;
                            allFiles.push(file);
                        }
                    }
                }
                if (promises.length > 0) {
                    const resolvedFiles = await Promise.all(promises);
                    for (const files of resolvedFiles) {
                        allFiles.push(...files);
                    }
                }
                if (allFiles.length > 0) {
                    handleFiles(allFiles);
                } else if (event.dataTransfer.files.length > 0) {
                    handleFiles(event.dataTransfer.files);
                }
            } else if (event.dataTransfer && event.dataTransfer.files.length) {
                handleFiles(event.dataTransfer.files);
            }
        }, false);
    }

    // --- HANDLE FILES (EPS Support Improved) ---
    function base64ToFile(base64, filename) {
        const byteString = atob(base64);
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
        }
        const blob = new Blob([ab], { type: 'image/png' });
        return new File([blob], filename, { type: 'image/png' });
    }
    window.handleFiles = async function handleFiles(files) {
        if (files.length === 0) return;

        // 🟠 IMMEDIATE UI FEEDBACK: Hide upload section and show Add More button
        const uploadSection = document.querySelector('.file-upload-section');
        const addMoreBtn = document.getElementById('addMoreFilesButton');
        const previewContainer = document.getElementById('filePreviewContainer');

        if (uploadSection) uploadSection.style.display = 'none';
        if (addMoreBtn) addMoreBtn.style.display = 'inline-flex';

        // Show a global loading state if needed, or rely on individual card spinners
        // (Individual cards have spinners by default)

        const user = auth.currentUser;

        // Get usage synchronously from global state to avoid blocking file load
        let usage = window.userUsageData || { plan: 'free', limit: 10 };
        let currentPlan = 'free';
        if (usage.plan) {
            const rawPlan = String(usage.plan).toLowerCase().trim();
            if (rawPlan.includes('premium')) currentPlan = 'premium';
            else if (rawPlan.includes('pro')) currentPlan = 'pro';
        } else if (usage.limit) {
            if (usage.limit >= 100) currentPlan = 'premium';
            else if (usage.limit >= 70) currentPlan = 'pro';
        }

        let maxFiles = 50;
        if (currentPlan === 'free') {
            maxFiles = usage.limit || 10;
        } else if (currentPlan === 'pro') {
            maxFiles = 200;
        } else if (currentPlan === 'premium') {
            maxFiles = 300;
        }

        if (files.length > maxFiles) {
            alert(`Your ${currentPlan.toUpperCase()} plan allows processing up to ${maxFiles} files at once. You selected ${files.length} files. Please reduce the number of files or upgrade.`);

            // Restore upload section if rejected
            if (uploadedFilesData.length === 0 && uploadSection) uploadSection.style.display = 'flex';
            if (addMoreBtn) addMoreBtn.style.display = 'none';
            return;
        }

        // In the background, fetch fresh usage without blocking rendering
        if (user && user.email) {
            getMetadataUsage(user.email).then(freshUsage => {
                window.userUsageData = { ...freshUsage, email: user.email };
                if (typeof updateUsageUI === 'function') {
                    updateUsageUI();
                }
            }).catch(e => console.warn("Background usage check failed:", e));
        }

        // Separate vector and non-vector files
        const vectorFiles = [];
        const normalFiles = [];

        for (const file of files) {
            const isSvg = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
            const isEps = file.name.toLowerCase().endsWith('.eps');

            if (isSvg || isEps) {
                vectorFiles.push(file);
            } else {
                normalFiles.push(file);
            }
        }

        // Process vector files with batch checklist (Only if Copyright Check is Enabled)
        const copyrightToggle = document.getElementById('copyrightToggle');
        const isCopyrightCheckEnabled = copyrightToggle ? copyrightToggle.checked : false;

        if (vectorFiles.length > 0) {
            if (isCopyrightCheckEnabled) {
                await showBatchVectorChecklist(vectorFiles);
                return; // Wait for user to click Continue/Cancel
            } else {
                // Toggle OFF: Process vectors in parallel
                vectorFiles.map(file => processVectorFile(file));
            }
        }

        // Process normal files in parallel
        normalFiles.map(file => processVectorFile(file));
    }

    // Show batch checklist for multiple vector files
    async function showBatchVectorChecklist(files) {
        const analysisResults = [];

        for (const file of files) {
            const isSvg = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');

            if (isSvg) {
                const results = await analyzeSvgFile(file);
                analysisResults.push({ file, results });
            } else {
                // EPS - generic warnings
                analysisResults.push({
                    file,
                    results: {
                        noGradientMesh: { pass: true, status: 'warning' },
                        textOutlined: { pass: true, status: 'warning' },
                        noRasterImage: { pass: true, status: 'warning' },
                        strokeExpanded: { pass: true, status: 'warning' },
                        transparencyFound: { pass: true, status: 'warning' }
                    }
                });
            }
        }

        displayBatchChecklist(analysisResults);
        pendingVectorFiles = analysisResults;
    }

    // Display batch checklist in modal
    function displayBatchChecklist(analysisResults) {
        const modal = document.getElementById('vectorChecklistModal');
        const titleElem = modal.querySelector('h3');
        const resultsDiv = document.getElementById('checklistResults');

        // Update title based on count
        const fileCount = analysisResults.length;
        titleElem.textContent = fileCount === 1
            ? '📋 Vector File Quality Checklist'
            : `📋 Vector Files Quality Checklist (${fileCount} files)`;

        // Generate checklist for each file
        resultsDiv.innerHTML = `
                    <div class="checklist-files-container">
                        ${analysisResults.map(({ file, results }, index) => {
            const checks = [
                { key: 'noGradientMesh', label: 'No gradient mesh', emoji: '🎨' },
                { key: 'textOutlined', label: 'Text outlined', emoji: '📝' },
                { key: 'noRasterImage', label: 'No raster image', emoji: '🖼️' },
                { key: 'strokeExpanded', label: 'Stroke expanded', emoji: '✏️' },
                { key: 'transparencyFound', label: 'Transparency found', emoji: '👁️' }
            ];

            return `
                                <div class="checklist-file-block">
                                    <div class="checklist-file-header">
                                        <span class="checklist-file-number">#${index + 1}</span>
                                        <span class="checklist-file-name">${file.name}</span>
                                    </div>
                                    <div class="checklist-results">
                                        ${checks.map(check => {
                const result = results[check.key];
                const icon = result.status === 'pass' ? '✓' :
                    result.status === 'warning' ? '⚠' : '✗';
                const statusClass = `check-${result.status}`;

                return `
                                                <div class="checklist-item ${statusClass}">
                                                    <span class="check-icon">${icon}</span>
                                                    <span class="check-label">${check.emoji} ${check.label}</span>
                                                </div>
                                            `;
            }).join('')}
                                    </div>
                                </div>
                            `;
        }).join('')}
                    </div>
                `;

        modal.style.display = 'flex';
    }


    // Extract Preview from Video file
    async function extractVideoPreview(videoFile) {
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.muted = true;
            video.playsInline = true;
            video.src = URL.createObjectURL(videoFile);

            video.onloadedmetadata = () => {
                const duration = (isNaN(video.duration) || !isFinite(video.duration) || video.duration === 0) ? 2 : video.duration;
                const seekTime = Math.min(1, duration * 0.1);
                video.currentTime = seekTime;
            };

            video.onseeked = () => {
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                const isVertical = video.videoWidth < video.videoHeight;

                canvas.toBlob((blob) => {
                    URL.revokeObjectURL(video.src);
                    if (blob) {
                        const f = new File([blob], videoFile.name + ".jpg", { type: 'image/jpeg' });
                        f.isVertical = isVertical;
                        resolve(f);
                    } else {
                        reject(new Error("Failed to extract video frame"));
                    }
                }, 'image/jpeg', 0.9);
            };

            video.onerror = (e) => {
                URL.revokeObjectURL(video.src);
                reject(new Error("Video load error: " + (video.error ? video.error.message : 'Unknown error')));
            };
        });
    }


    // Extract Preview from AI (PDF-compatible) file
    async function extractAiPreview(aiFile) {
        // Initialize PDF.js
        const pdfjsLib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
        if (!pdfjsLib) throw new Error("PDF.js library not loaded");

        // Ensure worker is set correctly
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }

        try {
            const arrayBuffer = await aiFile.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer); // FIX: Convert to Uint8Array for strict parsing

            const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
            const pdf = await loadingTask.promise;
            const page = await pdf.getPage(1);

            const viewport = page.getViewport({ scale: 1.5 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            await page.render({ canvasContext: context, viewport: viewport }).promise;

            return new Promise((resolve, reject) => {
                canvas.toBlob((blob) => {
                    if (blob) {
                        const file = new File([blob], aiFile.name.replace(/\.ai$/i, '.png'), { type: "image/png" });
                        resolve(file);
                    } else {
                        reject(new Error("Canvas to Blob conversion failed"));
                    }
                }, 'image/png');
            });
        } catch (error) {
            console.error("PDF.js extraction error:", error);
            throw new Error("Invalid PDF Structure. Falling back to server render.");
        }
    }

    // Function to upscale image using ClipDrop
    async function upscaleImageToClipDrop(cardId, file) {
        const upscaleBtn = document.getElementById(`upscale-btn-${cardId}`);
        const originalText = upscaleBtn.innerHTML;
        const spinner = document.querySelector(`#${cardId} .image-spinner`);

        try {
            upscaleBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Upscaling...';
            upscaleBtn.disabled = true;
            if (spinner) spinner.style.display = 'block';

            // Get Firebase auth token
            const user = auth.currentUser;
            if (!user) {
                alert('Please sign in to use the Upscale feature.');
                upscaleBtn.innerHTML = originalText;
                upscaleBtn.disabled = false;
                if (spinner) spinner.style.display = 'none';
                return;
            }
            const idToken = await user.getIdToken();

            // Calculate target dimensions (2x upscale, capped at 4096)
            const imgEl = document.querySelector(`#${cardId} .thumbnail-medium`);
            const origW = imgEl ? imgEl.naturalWidth : 1024;
            const origH = imgEl ? imgEl.naturalHeight : 1024;
            let targetW = origW * 2;
            let targetH = origH * 2;
            if (targetW > 4096 || targetH > 4096) {
                const scale = 4096 / Math.max(targetW, targetH);
                targetW = Math.round(targetW * scale);
                targetH = Math.round(targetH * scale);
            }

            const formData = new FormData();
            formData.append('image_file', file);
            formData.append('target_width', String(targetW));
            formData.append('target_height', String(targetH));

            const response = await fetch('https://metagen-pro-api.metagenp.workers.dev/clipdrop/upscale', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + idToken },
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }

            const upscaledBlob = await response.blob();

            // Create a new File object from the upscaled blob
            const upscaledFile = new File([upscaledBlob], file.name, { type: upscaledBlob.type || file.type });

            // Replace image source in UI
            const imgElement = document.querySelector(`#${cardId} .thumbnail-medium`);
            if (imgElement) {
                const url = URL.createObjectURL(upscaledFile);
                imgElement.src = url;
            }

            // Update fileObject in uploadedFilesData so Embed Metadata uses the upscaled version
            const fileDataEntry = uploadedFilesData.find(f => f.id === cardId);
            if (fileDataEntry) {
                fileDataEntry.fileObject = upscaledFile;
            }

            // Hide the button after successful upscale
            upscaleBtn.style.display = 'none';

        } catch (error) {
            console.error('Error upscaling image:', error);
            alert('Failed to upscale image. Please try again.\n' + error.message);
            upscaleBtn.innerHTML = originalText;
            upscaleBtn.disabled = false;
        } finally {
            if (spinner) spinner.style.display = 'none';
        }
    }


    // Helper to capture a small thumbnail for history
    function captureThumbnail(cardId, size = 120) {
        const img = document.querySelector(`#${cardId} .thumbnail-medium`);
        if (!img || !img.complete || img.naturalWidth === 0) return null;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Keep aspect ratio
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (w > h) {
            h = (h / w) * size;
            w = size;
        } else {
            w = (w / h) * size;
            h = size;
        }

        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(img, 0, 0, w, h);
        return canvas.toDataURL('image/jpeg', 0.7);
    }

    // Process file after checklist approval or for non-vector files
    async function processVectorFile(file) {
        const card = document.createElement('div');
        card.className = 'file-preview-card';
        card.id = 'file-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
        const isEps = file.name.toLowerCase().endsWith('.eps');
        const isAi = file.name.toLowerCase().endsWith('.ai');
        const isVideo = file.type.startsWith('video/') || ['mp4', 'mov', 'avi', 'webm', 'mkv'].some(ext => file.name.toLowerCase().endsWith('.' + ext));
        const placeholderSrc = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48L3N2Zz4=`;

        const sizeStr = file.size < 1024 * 1024
            ? (file.size / 1024).toFixed(1) + ' KB'
            : (file.size / (1024 * 1024)).toFixed(1) + ' MB';

        window.processVectorFile = processVectorFile;

        card.innerHTML = `
                    <div class="card-image-col">
                        <div class="card-checkbox-container">
                            <input type="checkbox" class="bulk-checkbox" data-file-id="${card.id}" onchange="handleCheckboxChange()">
                        </div>
                        <div class="card-image-actions">
                            <button class="card-image-action-btn regenerate" title="Regenerate" onclick="regenerateMetadata(this)"><span style="font-size:1.1em;">&#x21bb;</span></button>
                            <button class="card-image-action-btn close" title="Close" onclick="closeCard(this)"><span style="font-size:1.1em;">&#x2716;</span></button>
                        </div>
                        <img loading='lazy' src="${placeholderSrc}" alt="${file.name}" class="thumbnail-medium" style="position: relative; overflow: hidden; border-radius: 12px;">

                        <!-- Quality Scan Overlay -->
                        <div id="qualityScanOverlay-${card.id}" class="sales-scan-overlay" style="display:none; z-index: 9;">
                            <div class="sales-scan-line"></div>
                        </div>
                        
                        <!-- Image Properties Overlay -->
                        <div class="image-properties-overlay">
                            <div class="prop-row"><span class="prop-label">Name:</span><span class="prop-value">${file.name}</span></div>
                            <div class="prop-row"><span class="prop-label">Size:</span><span class="prop-value">${sizeStr}</span></div>
                            <div class="prop-row"><span class="prop-label">Type:</span><span class="prop-value">${file.type || 'N/A'}</span></div>
                            <div class="prop-row"><span class="prop-label">Dims:</span><span class="prop-value" id="dims-${card.id}">...</span></div>
                        </div>

                        ${isAi ? '<div class="file-type-badge ai-badge" style="position: absolute; top: 10px; left: 10px; padding: 4px 8px; border-radius: 4px; font-size: 0.7em; font-weight: bold; background: #FF7F18; color: white;">AI</div>' : ''}
                        ${isVideo ? '<div class="file-type-badge video-badge" style="position: absolute; top: 15px; left: 46px; padding: 4px 8px; border-radius: 4px; font-size: 0.7em; font-weight: bold; background: #EF4444; color: white; z-index: 1000;">VIDEO</div>' : ''}
                        <div class="image-spinner" style="display:block;"></div>
                        
                        <!-- Copyright Status -->
                        <div id="copyright-status-${card.id}" class="copyright-status-container" style="margin-top: 2px; background: var(--bg-input); border: 1px solid rgba(255, 255, 255, 0.15); box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3); padding: 4px 12px; border-radius: 14px; text-align: center;">
                            <div class="copyright-badge copyright-checking">
                                <span class="image-spinner" style="display:inline-block; width:30px; height:30px; border-width:5px; margin:0;"></span> Checking Copyright...
                            </div>
                        </div>

                        <!-- Quality Status Badge (Bottom) -->
                        <div id="quality-status-container-${card.id}" class="quality-status-container" style="position: relative; left: 0; right: 0; width: 100%; text-align: center; z-index: 10;">
                            <div class="quality-status-badge pending" id="quality-badge-${card.id}" style="backdrop-filter: blur(25px); margin-top: 2px; background: var(--bg-input); border: 1px solid rgba(255, 255, 255, 0.15); box-shadow: 0 4px 15px rgba(0,0,0,0.3); padding: 5px 12px; font-size: 0.7em; color: #0eb17c; font-weight: 800;">
                                <i class="fas fa-microscope"></i> <span data-i18n="quality_pending">Quality: Pending</span>
                            </div>
                        </div>

                        <!-- SEO Score Meter -->
                        <div class="seo-meter-container" id="seo-meter-${card.id}" style="display:none;">
                            <div class="locked-overlay" id="seo-lock-${card.id}" style="display:none;" onclick="showProUpgradeAlert()">
                                <div class="lock-icon" title="Pro Feature">🔒</div>
                            </div>
                            <div class="seo-score-header">
                               <span>
                                  <span data-i18n="seo_score">SEO Score</span>
                                    <a href="https://www.aimetagenpro.com/p/seo-score.html" target="blank" class="seo-info-icon" title="Learn how to improve SEO Score">i</a>
                                  </span>
                                <span class="seo-badge excellent" id="seo-badge-${card.id}">0 / 100 🟢 Excellent</span>
                            </div>
                            <div class="seo-progress-bg">
                                <div class="seo-progress-fill excellent" id="seo-progress-${card.id}" style="width: 0%;"></div>
                            </div>
                            <div class="seo-suggestions" id="seo-suggestions-${card.id}" style="color:var(--text-muted); font-size:0.75em; margin-top:8px; display:none; flex-direction:column; gap:4px; padding:6px; border-radius:4px; background:var(--bg-tertiary); border: 1px dashed var(--border-color);"></div>
                        </div>

                        <!-- Rejection Predictor Meter -->
                        <div class="rejection-meter-container" id="rejection-meter-${card.id}" style="display:none;">
                            <div class="locked-overlay" id="rejection-lock-${card.id}" style="display:none;" onclick="showProUpgradeAlert()">
                                <div class="lock-icon" title="Pro Feature">🔒</div>
                            </div>
                            <div class="rejection-header">
                                <span><span data-i18n="rejection">Rejection Chance</span> <button class="seo-info-icon" onclick="openRejectionInfoModal()" title="How to reduce rejection chance">i</button></span>
                                <span class="rejection-badge rejection-low" id="rejection-badge-${card.id}">0%</span>
                            </div>
                            <div class="rejection-progress-bg">
                                <div class="rejection-progress-fill fill-low" id="rejection-progress-${card.id}" style="width: 0%;"></div>
                            </div>
                        </div>

                        <!-- Release Requirements Check -->
                        <div class="platform-requirements-container" id="release-req-${card.id}" style="display:none; padding-bottom:10px;">            
                             <div class="platform-req-header">
                                 <span><span>Release Requirements</span></span>
                             </div>
                             <div class="platform-req-item">
                                 <span>Model Release</span>
                                 <span class="req-status" id="req-model-${card.id}">...</span>
                             </div>
                             <div class="platform-req-item">
                                 <span>Property Release</span>
                                 <span class="req-status" id="req-property-${card.id}">...</span>
                             </div>
                             <div class="release-upload-container" id="release-upload-container-${card.id}" style="display:none; margin-top:8px; width:100%;">
                                 <button class="action-button blue-button" style="width:100%; text-align:center; padding: 6px;" onclick="document.getElementById('release-input-${card.id}').click();"><i class="fas fa-upload"></i> Upload Releases</button>
                                 <input type="file" id="release-input-${card.id}" multiple class="release-file-input" style="display:none;" onchange="handleReleaseUpload(this, '${card.id}')">
                                 <div id="release-files-list-${card.id}" style="font-size:0.75em; margin-top:5px; color: var(--accent-orange); word-break: break-all;"></div>
                             </div>
                        </div>
                        
                        <button id="upscale-btn-${card.id}" class="action-button blue-button" style="display:none; width:100%; margin-top:8px; justify-content:center; align-items:center; gap:6px;">
                            <i class="fas fa-expand-arrows-alt"></i> Upscale (Advance AI)
                        </button>

                        <div class="card-filename" style="display:none;">${file.name}</div>
                    </div>
                    <div class="card-meta-col">
                        <!-- Metadata Section -->
                        <div class="meta-translation-controls" style="margin-bottom: 15px; padding: 6px; background: var(--bg-input); border-radius: 6px; border: 1px solid #334155; display: flex; justify-content: space-between; align-items: center;">
                            <div style="display: flex; gap: 10px; align-items: center;">
                                <span style="font-size: 0.7em; color: var(--text-muted);"><i class="fas fa-language"></i> <span data-i18n="translate">Translate</span>:</span>
                                <select id="translate-lang-${card.id}" style="padding: 4px 8px; border-radius: 4px; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-color);">
                                     <option value="en">English</option>
                                     <option value="es">Spanish</option>
                                     <option value="fr">French</option>
                                     <option value="de">German</option>
                                     <option value="ja">Japanese</option>
                                     <option value="pt">Portuguese</option>
                                     <option value="it">Italian</option>
                                     <option value="bn">Bengali</option>
                                     <option value="hi">Hindi</option>
                                     <option value="ar">Arabic</option>
                                     <option value="zh">Chinese</option>
                                     <option value="ko">Korean</option>
                                     <option value="id">Indonesian</option>
                                </select>
                                <button class="action-button blue-button" style="padding: 4px 12px; font-size: 0.65em; white-space: nowrap; flex-shrink: 0;" onclick="translateMetadata('${card.id}')"><span data-i18n="go">Go</span></button>
                            </div>
                        </div>
                        <div class="meta-section" style="position: relative;">
                            <div class="meta-section-label" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                                <span>
                                    <span data-i18n="label_title">Title</span>
                                    <span id="title-count-${card.id}" class="meta-count"></span>
                                </span>
                                <div style="display: flex; gap: 8px; align-items: center;">
                                    <button class="action-button blue-button TitleBtn" id="check-clarity-btn-${card.id}" style="padding: 5px 8px; font-size: 0.72em; display: none; height: auto;" onclick="checkTitleClarity('${card.id}')">
                                        <i class="fas fa-magic" style='margin-right: 5px;'></i> Clarity
                                    </button>
                                    <button class="copy-btn" onclick="copyToClipboard(this, 'title')"><i class="icon-copy"></i><span data-i18n="btn_copy">Copy</span></button>
                                </div>
                            </div>
                            <div class="meta-title" contenteditable="true" oninput="updateTitle(this)"></div>

                            <!-- Clarity Checker Widget -->
                            <div id="clarity-checker-container-${card.id}" class="clarity-checker-container" style="display: none;">
                                <div class="clarity-scores-row">
                                    <div class="clarity-score-item">
                                        <div class="clarity-score-header">
                                            <span>Accuracy</span>
                                            <span id="clarity-grammar-value-${card.id}" class="clarity-score-value">0%</span>
                                        </div>
                                        <div class="clarity-progress-bg">
                                            <div id="clarity-grammar-bar-${card.id}" class="clarity-progress-fill" style="width: 0%;"></div>
                                        </div>
                                    </div>
                                    <div class="clarity-score-item">
                                        <div class="clarity-score-header">
                                            <span>Buyer Appeal</span>
                                            <span id="clarity-appeal-value-${card.id}" class="clarity-score-value">0%</span>
                                        </div>
                                        <div class="clarity-progress-bg">
                                            <div id="clarity-appeal-bar-${card.id}" class="clarity-progress-fill" style="width: 0%;"></div>
                                        </div>
                                    </div>
                                </div>
                                <div id="clarity-details-${card.id}" class="clarity-details">
                                    <div id="clarity-feedback-${card.id}" class="clarity-feedback"></div>
                                    <ul id="clarity-suggestions-${card.id}" class="clarity-suggestions"></ul>
                                </div>
                                <div id="clarity-lock-overlay-${card.id}" class="locked-overlay" style="display: none;" onclick="scrollToPricing(); alert('Upgrade to PRO or PREMIUM plan to unlock actionable title optimization suggestions.')">
                                    <div class="lock-icon" style="font-size: 1.25em;">🔒</div>
                                    <span style="font-size: 0.7em; font-weight: bold; color: var(--text-primary);">Unlock Pro Recommendations</span>
                                </div>
                                <div class="clarity-header-actions" style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;">
                                    <button class="action-button blue-button TitleBtn" id="clarity-fix-btn-${card.id}" style="padding: 2px 8px; font-size: 0.72em; height: auto;" onclick="fixTitleWithAI('${card.id}')">
                                        <i class="fas fa-magic"></i> AI Fix
                                    </button>
                                    <button class="action-button" style="padding: 2px 8px; font-size: 0.72em; height: auto; background: #e12727c7; border: 1px solid rgba(255,255,255,0.2); color: #fff; cursor: pointer;" onclick="document.getElementById('clarity-checker-container-${card.id}').style.display='none'">
                                        <i class="fas fa-times"></i> Close
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div class="meta-section" id="desc-section-${card.id}">
                            <div class="meta-section-label"><span><span data-i18n="label_desc">Description</span> <span id="desc-count-${card.id}" class="meta-count"></span></span><button class="copy-btn" onclick="copyToClipboard(this, 'description')"><i class="icon-copy"></i><span data-i18n="btn_copy">Copy</span></button></div>
                            <div class="meta-description"></div>
                        </div>
                        <div class="meta-section">
                            <div class="meta-section-label"><span><span data-i18n="label_keywords">Keywords</span> <span id="keyword-count-${card.id}" class="meta-count"></span></span><button class="copy-btn" onclick="copyToClipboard(this, 'keywords')"><i class="icon-copy"></i><span data-i18n="btn_copy">Copy</span></button></div>
                            <div class="meta-keywords"></div>
                            <div class="keyword-add-container">
                                <input type="text" class="keyword-add-input" data-i18n="placeholder_add_kw" placeholder="Add keyword..." id="keyword-input-${card.id}" onkeypress="if(event.key === 'Enter') addKeyword('${card.id}')">
                                <button class="keyword-add-btn" style='white-space: nowrap; flex-shrink: 0;' onclick="addKeyword('${card.id}')">+ <span data-i18n="btn_add">Add</span></button>
                            </div>
                            <div class="keyword-preset-container" style="margin-top: 8px; display: flex; gap: 8px; align-items: center;">
                                <select class="preset-select-dropdown" data-card-id="${card.id}" onchange="window.applyPresetToCard('${card.id}', this.value)" style="flex: 1; padding: 4px 8px; border-radius: 4px; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-color); font-size: 0.72em; width: 80%;">
                                    <option value="">📁 Apply Preset/Templates...</option>
                                </select>
                                <button class="action-button blue-button" onclick="window.savePresetFromCard('${card.id}')" title="Save current keywords as preset template" style="padding: 4px 8px; font-size: 0.72em; margin-top: 0; white-space: nowrap; flex-shrink: 0;">
                                    <i class="fas fa-save"></i> Save Preset
                                </button>
                            </div>
                        </div>
                        
                        <!-- AI Category Select (Adobe Stock) -->
                        <div class="meta-section adobe-only-section" style="display:none;"> 
                          <div class="meta-section-label">
                              <span><i class="fas fa-tags"></i> <span data-i18n="ai_category">AI Category (Adobe Stock)</span></span>
                          </div>
                             <select class="meta-category-select" id="ai-category-${card.id}">
                                <option value="">Select Category...</option>
                                <option value="Animals">Animals</option>
                                <option value="Buildings and Architecture">Buildings and Architecture</option>
                                <option value="Business">Business</option>
                                <option value="Drinks">Drinks</option>
                                <option value="Environment">Environment</option>
                                <option value="States of Mind">States of Mind</option>
                                <option value="Food">Food</option>
                                <option value="Graphic Resources">Graphic Resources</option>
                                <option value="Hobbies and Leisure">Hobbies and Leisure</option>
                                <option value="Industry">Industry</option>
                                <option value="Landscapes">Landscapes</option>
                                <option value="Lifestyle">Lifestyle</option>
                                <option value="People">People</option>
                                <option value="Plants and Flowers">Plants and Flowers</option>
                                <option value="Culture and Religion">Culture and Religion</option>
                                <option value="Science">Science</option>
                                <option value="Social Issues">Social Issues</option>
                                <option value="Sports">Sports</option>
                                <option value="Technology">Technology</option>
                                <option value="Transport">Transport</option>
                                <option value="Travel">Travel</option>
                            </select>
                        </div>
                        
                        <!-- New Style & Mood Grid -->
                        <div class="style-mood-grid">
                            <div class="meta-subsection" id="style-section-${card.id}" style="display:none;">
                                <div class="meta-section-label"><span><i class="icon-palette"></i> <span data-i18n="style">Style</span></span><button class="copy-btn mini" onclick="copyToClipboard(this, 'style')"><span data-i18n="btn_copy">Copy</span></button></div>
                                <div class="meta-style-container"></div>
                            </div>
                            <div class="meta-subsection" id="mood-section-${card.id}" style="display:none;">
                                <div class="meta-section-label"><span><i class="icon-smile"></i> <span data-i18n="mode">Mode</span></span><button class="copy-btn mini" onclick="copyToClipboard(this, 'mood')"><span data-i18n="btn_copy">Copy</span></button></div>
                                <div class="meta-mood-container"></div>
                            </div>
                        </div>

                        <button class="export-csv-btn" style="display:none;">Export CSV</button>
                        <button id="btn-eps-${card.id}" class="action-button purple-button" style="display:${((file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) && ((window.userUsageData?.plan && window.userUsageData.plan.toLowerCase().includes('premium')) || (window.userUsageData?.limit >= 100))) ? 'flex' : 'none'}; width:100%; margin-top:8px; justify-content:center; align-items:center; gap:6px;" disabled onclick="downloadAsEps('${card.id}')">
                            <i class="icon-download"></i> <span data-i18n='download'>Download</span> EPS10
                        </button>
                        <!-- Image to Prompt Section -->
                        <div class="prompt-section">
                             <div class="prompt-spinner" style="display: none;"></div>
                             <div class="prompt-result-container" style="display: none; width: 100%;">
                                 <!-- Style Tab Buttons -->
                                 <div class="prompt-tabs">
                                     <button class="prompt-tab-btn active" data-style="realistic" onclick="switchPromptStyle('${card.id}', 'realistic')">
                                         📷 <span data-i18n="style_realistic">Realistic</span>
                                     </button>
                                     <button class="prompt-tab-btn" data-style="illustration" onclick="switchPromptStyle('${card.id}', 'illustration')" style='background: #8b5cf6;'>
                                         🎨 <span data-i18n="style_illustration">Illustration</span>
                                     </button>
                                     <button class="prompt-tab-btn" data-style="3d" onclick="switchPromptStyle('${card.id}', '3d')" style='width: 100%;
    background: #f16908;'>
                                         🧊 <span data-i18n="style_3d">3D Render</span>
                                     </button>
                                 </div>
                                 
                                 <!-- Prompt Text Content Areas -->
                                 <div class="prompt-text-wrapper" style="position: relative; width: 100%;">
                                     <div class="prompt-text prompt-style-content active" id="prompt-realistic-${card.id}" style="font-size: 0.82em; line-height: 1.5; color: var(--text-secondary); max-height: 150px; overflow-y: auto; padding: 6px 4px; background: var(--bg-input); border: 1px solid var(--border-color); border-radius: 6px; word-break: break-word;"></div>
                                     <div class="prompt-text prompt-style-content" id="prompt-illustration-${card.id}" style="display: none; font-size: 0.82em; line-height: 1.5; color: var(--text-secondary); max-height: 150px; overflow-y: auto; padding: 6px 4px; background: var(--bg-input); border: 1px solid var(--border-color); border-radius: 6px; word-break: break-word;"></div>
                                     <div class="prompt-text prompt-style-content" id="prompt-3d-${card.id}" style="display: none; font-size: 0.82em; line-height: 1.5; color: var(--text-secondary); max-height: 150px; overflow-y: auto; padding: 6px 4px; background: var(--bg-input); border: 1px solid var(--border-color); border-radius: 6px; word-break: break-word;"></div>
                                 </div>
                                 
                                 <!-- Actions -->
                                 <div class="prompt-actions-inline">
                                     <button class="action-button blue-button" onclick="copyPromptFromCard(this)"><i class="icon-copy"></i> <span data-i18n="btn_copy">Copy</span></button>
                                     <button class="action-button purple-button" onclick="copyAllPromptsFromCard('${card.id}')"><i class="icon-copy"></i> <span data-i18n="btn_copy_all">Copy All</span></button>
                                     <button class="action-button green-button" onclick="downloadPromptFromCard(this)"><i class="icon-download"></i> <span data-i18n="download">Download</span></button>
                                 </div>
                             </div>
                        </div>

                    </div>`;

        const activePlatform = document.querySelector('.platform-button.active')?.dataset.platform;
        if (activePlatform === 'adobe') {
            const adobeSec = card.querySelector('.adobe-only-section');
            if (adobeSec) adobeSec.style.display = 'block';
        }

        previewContainer.appendChild(card);
        const currentLang = localStorage.getItem('selectedLanguage') || 'en';
        if (typeof updateUI === 'function') {
            updateUI(currentLang, card);
        }

        const imgElement = card.querySelector('.thumbnail-medium');

        // NEW: Update dimensions when image loads
        if (imgElement) {
            imgElement.onload = function () {
                const width = this.naturalWidth;
                const height = this.naturalHeight;
                const dimsEl = document.getElementById(`dims-${card.id}`);
                if (dimsEl) {
                    dimsEl.textContent = `${width} x ${height}`;
                }

                // NEW: Update Video Badge for Short Videos
                const fileDataObj = uploadedFilesData.find(f => f.id === card.id);
                if (fileDataObj && fileDataObj.isVideo && (width < height || fileDataObj.isVertical)) {
                    fileDataObj.isVertical = true;
                    const videoBadge = card.querySelector('.video-badge');
                    if (videoBadge) {
                        videoBadge.textContent = "SHORT VIDEO";
                        videoBadge.style.background = "linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)";
                    }
                }

                // Capture thumbnail for history
                try {
                    if (typeof captureThumbnail === 'function') {
                        const thumb = captureThumbnail(card.id, 100);
                        if (thumb) {
                            const entry = uploadedFilesData.find(f => f.id === card.id);
                            if (entry) entry.thumbnail = thumb;
                        }
                    }
                } catch (e) { console.warn("Thumb capture failed in onload:", e); }

                // Check if dimensions are unsuitable for microstock (Pro/Premium only)
                const userPlan = (window.userUsageData?.plan || 'free').toLowerCase();
                const isProOrPremium = userPlan.includes('pro') || userPlan.includes('premium') || userPlan.includes('agency');
                if ((file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'image/webp') && (width <= 1024 || height <= 1024)) {
                    const upscaleBtn = document.getElementById(`upscale-btn-${card.id}`);
                    if (upscaleBtn) {
                        upscaleBtn.style.display = 'flex';
                        upscaleBtn.onclick = () => {
                            if (isProOrPremium) {
                                upscaleImageToClipDrop(card.id, file);
                            } else {
                                alert("Upgrade to PRO/PREMIUM plan. Upscale (Advance AI) features are for pro & premium users only.");
                                if (typeof scrollToPricing === 'function') scrollToPricing();
                            }
                        };
                    }
                }
            };
        }

        const spinner = card.querySelector('.image-spinner');

        if (isEps) {
            // --- EPS Conversion Restriction (Premium Only) ---
            const user = auth.currentUser;

            // Plan check: checks if plan includes 'premium' OR 'pro', or if limit >= 100
            const userPlan = (window.userUsageData?.plan || '').toLowerCase();
            let isProOrPremium = userPlan.includes('premium') || userPlan.includes('pro') || userPlan.includes('agency') || (window.userUsageData?.limit >= 100);

            if (!isProOrPremium) {
                alert("Direct Vector/EPS conversion is a Pro/Premium feature. Please upgrade to use this feature.");
                openUpgradeModal('pro'); // অথবা আপনার প্রয়োজন অনুযায়ী 'premium' રાખতে পারেন
                spinner.style.display = 'none';
                return;
            }

            const formData = new FormData();
            formData.append('file', file); // 'file' নামেই পাঠাতে হবে, কারণ সার্ভারে upload.single('file') দেওয়া আছে

            // আপনার নতুন Render সার্ভারে রিকোয়েস্ট পাঠানো হচ্ছে
            fetch(`https://metagen-eps-server.onrender.com/api/extract-eps`, {
                method: 'POST',
                body: formData
            })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        const base64Data = data.base64;
                        imgElement.src = `data:image/jpeg;base64,${base64Data}`;

                        const newFileName = file.name;

                        // Copyright চেকের জন্য JPG প্রিভিউটি মেমরিতে রাখা হচ্ছে
                        const byteString = atob(base64Data);
                        const ab = new ArrayBuffer(byteString.length);
                        const ia = new Uint8Array(ab);
                        for (let i = 0; i < byteString.length; i++) {
                            ia[i] = byteString.charCodeAt(i);
                        }
                        const blob = new Blob([ab], { type: 'image/jpeg' });
                        const jpegFile = new File([blob], newFileName + ".jpg", { type: 'image/jpeg' });

                        // === এখানেই মূল ফিক্স করা হয়েছে ===
                        uploadedFilesData.push({
                            id: card.id,
                            name: newFileName,
                            fileObject: file, // <-- [FIX] এখানে অরিজিনাল EPS ফাইলটি সেভ রাখা হলো!
                            previewFile: jpegFile, // <-- AI/Copyright এর জন্য প্রিভিউ JPG আলাদা রাখলাম!
                            isAiFile: true, // EPS-কে ভিশন API এর জন্য AI ফাইলের মতো ট্রিট করা হবে
                            title: '',
                            keywords: '',
                            description: '',
                            style: '',
                            mood: '',
                            prompt: ''
                        });
                        updateAllButtonStates();

                        // Auto-run Copyright Check if enabled
                        if (document.getElementById('copyrightToggle') && document.getElementById('copyrightToggle').checked) {
                            checkCopyrightAndTrademark(jpegFile, card.id);
                        } else {
                            const statusEl = document.getElementById(`copyright-status-${card.id}`);
                            if (statusEl) statusEl.style.display = 'none';
                        }

                    } else {
                        throw new Error(data.error || 'Conversion failed, no preview found.');
                    }
                })
                .catch(error => {
                    console.error('Error extracting EPS preview:', error);
                    // Fallback icon যদি কোনো কারণে কনভার্ট না হয়
                    imgElement.src = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIiBmaWxsPSJub25lIiBzdHJva2U9IiM5NEE0QjgiIHN0cm9rZS13aWR0aD0iNCI+IDxyZWN0IHg9IjIiIHk9IjIiIHdpZHRoPSI5NiIgaGVpZHRoPSI5NiIgcng9IjgiIHJ5PSI4IiBmaWxsPSIjMUUyOTNCIi8+IDx0ZXh0IHg9IjUwIiB5PSI2MCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMzYiIGZpbGw9IiM5NEE0QjgiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtd2VpZ2h0PSJib2xkIj5FUFM8L3RleHQ+PC9zdmc+`;
                    alert("Failed to extract preview from EPS: " + error.message);
                })
                .finally(() => {
                    spinner.style.display = 'none';
                });

        } else if (isAi) {
            try {
                // Attempt 1: Client-side PDF.js extraction
                const previewFile = await extractAiPreview(file);
                imgElement.src = URL.createObjectURL(previewFile);
                uploadedFilesData.push({
                    id: card.id,
                    name: file.name,
                    fileObject: file,
                    previewFile: previewFile,
                    isAiFile: true,
                    title: '', keywords: '', description: '', style: '', mood: '', prompt: ''
                });

            } catch (error) {
                console.warn('Native AI preview failed. File is likely not PDF-compatible.', error);

                // সার্ভারে রিকোয়েস্ট না পাঠিয়ে সরাসরি অ্যালার্ট দিন এবং ডিফল্ট আইকন দেখান
                alert(`Could not extract preview for "${file.name}".\n\nFor visual previews, please save .ai files with the "Create PDF Compatible File" option checked in Illustrator.`);

                // Fallback generic AI icon (No server request to avoid 500 error)
                imgElement.src = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIiBmaWxsPSJub25lIiBzdHJva2U9IiNGRjdGMTgiIHN0cm9rZS13aWR0aD0iNCI+IDxyZWN0IHg9IjIiIHk9IjIiIHdpZHRoPSI5NiIgaGVpZHRoPSI5NiIgcng9IjgiIHJ5PSI4IiBmaWxsPSIjMUUyOTNCIi8+IDx0ZXh0IHg9IjUwIiB5PSI2MCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMzYiIGZpbGw9IiNGRjdGMTgiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtd2VpZ2h0PSJib2xkIj5BSTwvdGV4dD48L3N2Zz4=`;

                uploadedFilesData.push({
                    id: card.id,
                    name: file.name,
                    fileObject: file,
                    isAiFile: true,
                    title: '', keywords: '', description: '', style: '', mood: '', prompt: ''
                });
            } finally {
                spinner.style.display = 'none';
                updateAllButtonStates();

                // Auto-run Copyright Check if enabled
                if (document.getElementById('copyrightToggle') && document.getElementById('copyrightToggle').checked) {
                    const fileDataEntry = uploadedFilesData[uploadedFilesData.length - 1];
                    // প্রিভিউ ফাইল থাকলে কপিরাইট স্ক্যান করবে, না থাকলে ওয়ার্নিং দেখাবে
                    if (fileDataEntry && fileDataEntry.previewFile) {
                        checkCopyrightAndTrademark(fileDataEntry.previewFile, card.id);
                    } else {
                        const statusEl = document.getElementById(`copyright-status-${card.id}`);
                        if (statusEl) {
                            statusEl.style.display = 'block';
                            statusEl.innerHTML = '<div class="copyright-badge copyright-warning" style="font-size:0.75em;">⚠️ Preview Unavailable for Scan</div>';
                        }
                    }
                } else {
                    const statusEl = document.getElementById(`copyright-status-${card.id}`);
                    if (statusEl) statusEl.style.display = 'none';
                }
            }
        } else if (isVideo) {
            try {
                const previewFile = await extractVideoPreview(file);
                imgElement.src = URL.createObjectURL(previewFile);
                uploadedFilesData.push({
                    id: card.id,
                    name: file.name,
                    fileObject: file,
                    previewFile: previewFile,
                    isAiFile: true,
                    isVideo: true,
                    isVertical: previewFile.isVertical,
                    title: '',
                    keywords: '',
                    description: '',
                    style: '',
                    mood: '',
                    prompt: ''
                });
            } catch (error) {
                console.error('Video preview failed:', error);
                // Fallback icon for video
                imgElement.src = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIiBmaWxsPSJub25lIiBzdHJva2U9IiNFRjQ0NDQiIHN0cm9rZS13aWR0aD0iNCI+IDxyZWN0IHg9IjIiIHk9IjIiIHdpZHRoPSI5NiIgaGVpZHRoPSI5NiIgcng9IjgiIHJ5PSI4IiBmaWxsPSIjMUUyOTNCIi8+IDx0ZXh0IHg9IjUwIiB5PSI2MCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMjQiIGZpbGw9IiNFRjQ0NDQiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtd2VpZ2h0PSJib2xkIj5WSURFTzwvdGV4dD48L3N2Zz4=`;
                uploadedFilesData.push({
                    id: card.id,
                    name: file.name,
                    fileObject: file,
                    isVideo: true,
                    isVertical: false,
                    title: '',
                    keywords: '',
                    description: '',
                    style: '',
                    mood: '',
                    prompt: ''
                });
            } finally {
                spinner.style.display = 'none';
                updateAllButtonStates();
                const statusEl = document.getElementById(`copyright-status-${card.id}`);
                if (statusEl) statusEl.style.display = 'none';
            }
        } else {
            imgElement.src = URL.createObjectURL(file);
            spinner.style.display = 'none';

            uploadedFilesData.push({
                id: card.id,
                name: file.name,
                fileObject: file,
                isAiGenerated: file.isAiGenerated || false,
                title: '',
                keywords: '',
                description: '',
                style: '',
                mood: '',
                prompt: ''
            });
            updateAllButtonStates();

            // Auto-run Copyright Check if enabled (JPG/PNG)
            if (document.getElementById('copyrightToggle') && document.getElementById('copyrightToggle').checked) {
                checkCopyrightAndTrademark(file, card.id);
            } else {
                const statusEl = document.getElementById(`copyright-status-${card.id}`);
                if (statusEl) statusEl.style.display = 'none';
            }
        }
    }

    // --- COPYRIGHT CHECKER FUNCTION (UPDATED FOR LLAMA 4 & PIXTRAL) ---
    async function checkCopyrightAndTrademark(file, cardId) {
        const statusEl = document.getElementById(`copyright-status-${cardId}`);
        if (!statusEl) return;

        const badge = statusEl.querySelector('.copyright-badge');
        if (!badge) return;

        try {
            // 1. Check User Plan & Get Token
            const user = auth.currentUser;

            let currentPlan = 'free';


            if (user) {

                try {
                    const profileDoc = await db.collection('users').doc(user.email).get();
                    const profileData = profileDoc.exists ? profileDoc.data() : null;
                    currentPlan = (profileData?.plan || 'free').toLowerCase();
                } catch (e) { console.warn('Plan check failed:', e); }
            }

            // Stop processing if Free user (Backup check)
            if (currentPlan !== 'pro' && currentPlan !== 'premium' && currentPlan !== 'agency') {
                badge.className = 'copyright-badge copyright-warning';
                badge.innerHTML = '⚠️ Pro/Premium Only';
                return;
            }

            // 2. Resize Image & Convert to Base64 (To prevent 429 Token Limit Error)
            const MAX_DIMENSION = 800;
            const base64Data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = new Image();
                    img.onload = () => {
                        let width = img.width;
                        let height = img.height;

                        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
                            if (width > height) {
                                height *= MAX_DIMENSION / width;
                                width = MAX_DIMENSION;
                            } else {
                                width *= MAX_DIMENSION / height;
                                height = MAX_DIMENSION;
                            }
                        }

                        const canvas = document.createElement('canvas');
                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, width, height);

                        // Convert to optimized JPEG
                        resolve(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
                    };
                    img.onerror = reject;
                    img.src = e.target.result;
                };
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            const mimeType = "image/jpeg";

            const promptInstruction = `Act as a Trademark and Copyright Compliance Officer. 
                    Analyze this image strictly for:
                    1. Matches to Famous Logos (e.g., Nike Swoosh, Apple logo, McDonald's arches, Adidas stripes) - LOOK FOR SHAPES!
                    2. Specific Trademarked Characters (e.g., Mickey Mouse, Marvel superheroes)
                    3. Famous Brands/Text
                    4. WATERMARKS, TEXT OVERLAYS, SIGNATURES, or COPYRIGHT TOKENS (e.g., 'PixelPerfect', '@ArtistName', '© 2024')
        
                    CRITICAL: Even if it's just a simple shape (like a checkmark/swoosh), if it resembles a famous logo (like Nike), you MUST FLAG IT.
                    If ANY textual watermark or potential brand element is visible, FLAG IT.

                    Return strictly JSON: 
                    {"status": "warning", "detected": ["List items"]} OR {"status": "safe", "detected":[]}`;

            // 3. Set Proxy URL based on plan
            const proxyUrl = "https://metagen-pro-api.metagenp.workers.dev/generate";
            const accessToken = user ? await user.getIdToken() : "";

            // 4. Call Cloudflare Worker
            const response = await fetch(proxyUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${accessToken}`
                },
                body: JSON.stringify({
                    action: "copyrightCheck", // Action name for backend routing
                    prompt: promptInstruction,
                    image: base64Data,
                    mimeType: mimeType,
                    email: user?.email || "unknown"
                })
            });

            const data = await response.json();

            if (!response.ok) {
                if (response.status === 429) {
                    showLimitModal(data.error);
                    throw new Error("Daily limit reached");
                }
                throw new Error(`Edge API Error: ${data.error || response.statusText}`);
            }

            // 5. Parse response from Edge Function
            let jsonString = data.text || data.metadata || (data.choices && data.choices[0].message.content) || (data.candidates && data.candidates[0].content.parts[0].text) || "";

            // Clean JSON formatting
            jsonString = jsonString.replace(/```json/g, '').replace(/```/g, '').trim();
            let result = JSON.parse(jsonString);

            if (result.status === 'safe') {
                badge.className = 'copyright-badge copyright-safe';
                badge.innerHTML = '✅ Copyright Safe';
            } else {
                badge.className = 'copyright-badge copyright-warning';
                badge.innerHTML = `⚠️ ${result.detected.join(', ') || 'Trademark Detected'} <br>
                        <button class="action-button green-button" style="margin-top:8px; width:100%; font-size:0.75em; padding:5px; border-radius:6px; cursor:pointer;" 
                        onclick="sendToHealing('${cardId}')">🩹 Heal with AI</button>`;
                const card = document.getElementById(cardId);
                if (card) card.style.borderColor = '#EF4444';
            }
        } catch (error) {
            console.error("Copyright Check Error:", error);
            badge.className = 'copyright-badge copyright-warning';
            badge.innerHTML = `⚠️ Check Failed: ${error.message}`;
        }
    }

    // --- AI IMAGE QUALITY & ARTIFACT CHECKER (PRO/PREMIUM ONLY) ---
    window.checkImageQuality = async function (fileData) {
        const cardId = fileData.id;
        const badge = document.getElementById(`quality-badge-${cardId}`);
        const reportBox = document.getElementById(`quality-report-${cardId}`);

        const scanOverlay = document.getElementById(`qualityScanOverlay-${cardId}`);

        if (!badge) return;

        try {
            // 1. Check User Plan & Get Token
            const user = auth.currentUser;

            let currentPlan = 'free';
            let accessToken = '';

            if (user) {
                accessToken = await user.getIdToken();
                try {
                    const profileDoc = await db.collection('users').doc(user.email.toLowerCase()).get();
                    const profileData = profileDoc.exists ? profileDoc.data() : null;
                    currentPlan = (profileData?.plan || 'free').toLowerCase();
                } catch (e) { console.warn('Plan check failed', e); }
            }

            // Update UI to "Checking"
            const container = document.getElementById(`quality-status-container-${cardId}`);
            if (container) container.style.display = 'block';

            badge.className = 'quality-status-badge checking';
            badge.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking...';

            if (scanOverlay) scanOverlay.style.display = 'block';

            if (reportBox) {
                reportBox.style.display = 'block';
                reportBox.innerHTML = '<div class="quality-report-header">Analyzing Technical Quality...</div><div class="image-spinner" style="display:block; margin: 10px auto;"></div>';
            }

            // 2. Prepare Image (Resize if needed)
            const imageToProcess = fileData.previewFile || fileData.fileObject;
            const base64Data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = new Image();
                    img.onload = () => {
                        const MAX_DIM = 1024;
                        let w = img.width, h = img.height;
                        if (w > MAX_DIM || h > MAX_DIM) {
                            if (w > h) { h *= MAX_DIM / w; w = MAX_DIM; }
                            else { w *= MAX_DIM / h; h = MAX_DIM; }
                        }
                        const canvas = document.createElement('canvas');
                        canvas.width = w; canvas.height = h;
                        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                        resolve(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
                    };
                    img.src = e.target.result;
                };
                reader.readAsDataURL(imageToProcess);
            });

            // 3. Call Cloudflare Worker
            const qualityPrompt = `You are an expert image quality analyst for stock photography platforms. Analyze this image for technical quality issues. Check for: blur, noise/grain, compression artifacts, color banding, chromatic aberration, over/under exposure, AI-generated artifacts (extra fingers, distorted text, unnatural patterns), watermarks, logos. Return ONLY valid JSON in this exact format: {"overall_score": <0-100>, "issues": [{"type": "<issue name>", "description": "<brief description>", "severity": "<high|medium|low>", "regions": [[xmin, ymin, xmax, ymax]]}]}. If no issues found, return {"overall_score": 95, "issues": []}. The "regions" array must contain coordinate arrays [xmin, ymin, xmax, ymax] normalized from 0 to 100 indicating where each technical issue is visually located on the image. Be strict but fair.`;
            const proxyUrl = "https://metagen-pro-api.metagenp.workers.dev/generate";
            const response = await fetch(proxyUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${accessToken}`
                },
                body: JSON.stringify({
                    action: "qualityCheck",
                    prompt: qualityPrompt,
                    image: base64Data,
                    mimeType: "image/jpeg",
                    email: user?.email || "unknown"
                })
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "API Error");

            // 4. Parse Results
            let resStr = data.text || "";
            resStr = resStr.replace(/```json/gi, '').replace(/```/g, '').trim();
            const jsonStart = resStr.indexOf('{');
            const jsonEnd = resStr.lastIndexOf('}');

            if (jsonStart !== -1 && jsonEnd !== -1) {
                resStr = resStr.substring(jsonStart, jsonEnd + 1);
            }

            let results;
            try {
                results = JSON.parse(resStr);
            } catch (parseErr) {
                console.error("Quality Check JSON Parse Error:", parseErr, "Raw Text:", resStr);
                throw new Error("AI returned invalid JSON. Please try again.");
            }

            // 5. Update UI
            updateQualityUI(cardId, results);
            return results;

        } catch (error) {
            console.error("Quality Check Error:", error);
            badge.className = 'quality-status-badge danger';
            badge.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Check Failed: ${error.message}`;
            if (reportBox) reportBox.innerHTML = `<div class="quality-report-header" style="color: #EF4444;">Error: ${error.message}</div>`;
            return null;
        } finally {
            if (scanOverlay) scanOverlay.style.display = 'none';
        }
    };

    window.checkImageQualityFromBtn = async function (cardId) {
        const fileData = uploadedFilesData.find(f => f.id === cardId);
        if (!fileData) return;
        await checkImageQuality(fileData);
    };

    window.batchQualityCheck = async function () {
        const selectedCardIds = getSelectedCards();
        const filesToProcess = selectedCardIds.length > 0
            ? uploadedFilesData.filter(f => selectedCardIds.includes(f.id))
            : uploadedFilesData;

        if (filesToProcess.length === 0) {
            alert("No images to check.");
            return;
        }

        const btn = document.getElementById('batchQualityCheckButton');
        const originalHTML = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Batch Checking...';

        showBatchProgress('quality'); // stage 'quality' will use default/prompt icon for now

        let count = 0;
        for (const fileData of filesToProcess) {
            count++;
            updateBatchProgress(count, filesToProcess.length, fileData.name, 'quality');
            await checkImageQuality(fileData);
            // Minimal delay to avoid overwhelming the concurrent request limit
            await new Promise(r => setTimeout(r, 800));
        }

        btn.disabled = false;
        btn.innerHTML = originalHTML;
        hideBatchProgress(true);
        alert(`Batch Quality Check Complete for ${filesToProcess.length} images.`);
    };

    function updateQualityUI(cardId, results) {
        const badge = document.getElementById(`quality-badge-${cardId}`);
        if (!badge) return;

        // Save results to the badge for re-clicking
        badge.dataset.results = JSON.stringify(results);
        badge.style.cursor = 'pointer';
        badge.title = 'View Report';
        badge.onclick = () => showQualityModal(cardId, results);

        const score = results.overall_score || 0;
        const issues = results.issues || [];

        // Set Badge State
        if (score >= 80) {
            badge.className = 'quality-status-badge safe';
            badge.innerHTML = '<i class="fas fa-check-circle"></i> Quality: Safe';
        } else if (score >= 50) {
            badge.className = 'quality-status-badge warning';
            const issueSummary = issues.map(i => i.type).join(', ');
            badge.innerHTML = `<i class="fas fa-exclamation-circle"></i> Quality: Warning (${issueSummary})`;
        } else {
            badge.className = 'quality-status-badge danger';
            badge.innerHTML = '<i class="fas fa-times-circle"></i> Quality: Issues';
        }

        // Show the modal automatically after check
        showQualityModal(cardId, results);
    }

    window.showQualityModal = function (cardId, results) {
        const modal = document.getElementById('qualityResultModal');
        const body = document.getElementById('qualityModalBody');
        if (!modal || !body) return;

        // Increase modal width for heatmap
        const modalContent = modal.querySelector('.modal-content');
        if (modalContent) modalContent.style.maxWidth = '850px';

        const score = results.overall_score || 0;
        const issues = results.issues || [];

        const card = document.getElementById(cardId);
        const thumbnail = card ? card.querySelector('.thumbnail-medium') : null;
        const imgSrc = thumbnail ? thumbnail.src : '';

        let reportHtml = `
                    <div style="display: flex; gap: 30px; flex-wrap: wrap;">
                        <!-- Left: Visual Analysis / Heatmap -->
                        <div style="flex: 1; min-width: 300px;">
                            <div style="font-weight: 800; margin-bottom: 15px; color: var(--text-primary); display: flex; align-items: center; gap: 10px; font-size: 1.1em;">
                                <i class="fas fa-eye" style="color: var(--accent-blue);"></i> Visual Artifact Map
                            </div>
                            <div style="position: relative; background: #000; border-radius: 16px; overflow: hidden; border: 1px solid var(--border-color); box-shadow: 0 10px 30px rgba(0,0,0,0.1);">
                                <img id="quality-heatmap-img" src="${imgSrc}" style="width: 100%; display: block; opacity: 0.8;">
                                <canvas id="quality-heatmap-canvas" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;"></canvas>
                            </div>
                            <div style="margin-top: 15px; display: flex; gap: 15px; font-size: 0.85em; font-weight: 600;">
                                <div style="display: flex; align-items: center; gap: 6px;"><span style="width: 12px; height: 12px; background: rgba(239, 68, 68, 0.6); border-radius: 3px;"></span> High Severity</div>
                                <div style="display: flex; align-items: center; gap: 6px;"><span style="width: 12px; height: 12px; background: rgba(245, 158, 11, 0.6); border-radius: 3px;"></span> Medium/Low</div>
                            </div>
                        </div>

                        <!-- Right: Report Details -->
                        <div style="flex: 1.2; min-width: 300px;">
                            <div style="text-align: left; margin-bottom: 25px;">
                                <div style="font-size: 1.8em; font-weight: 800; color: var(--text-primary); margin-bottom: 4px; letter-spacing: -0.5px;">Technical Report</div>
                                <div style="color: var(--text-muted); font-size: 0.9em; font-weight: 500;">AI-Powered Quality Assessment</div>
                            </div>
                            
                            <div style="background: var(--bg-input); border-radius: 20px; padding: 20px; margin-bottom: 25px; border: 1px solid var(--border-color);">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                                    <span style="font-weight: 700; color: var(--text-secondary);">Quality Score</span>
                                    <div style="font-size: 1.6em; font-weight: 900; color: ${score >= 80 ? '#10B981' : (score >= 50 ? '#F59E0B' : '#EF4444')}">${score}<span style="font-size: 0.6em; opacity: 0.7;">/100</span></div>
                                </div>
                                <div style="height: 10px; width: 100%; background: rgba(0,0,0,0.1); border-radius: 5px; overflow: hidden;">
                                    <div style="height: 100%; width: ${score}%; background: linear-gradient(90deg, ${score >= 80 ? '#10B981, #059669' : (score >= 50 ? '#F59E0B, #D97706' : '#EF4444, #DC2626')}); border-radius: 5px;"></div>
                                </div>
                            </div>

                            <div id="quality-issues-list">`;

        if (issues.length > 0) {
            issues.forEach((issue, idx) => {
                const icon = issue.severity === 'high' ? 'fa-exclamation-triangle' : 'fa-info-circle';
                const color = issue.severity === 'high' ? '#EF4444' : '#F59E0B';
                const bg = issue.severity === 'high' ? 'rgba(239, 68, 68, 0.05)' : 'rgba(245, 158, 11, 0.05)';

                const clickCheck = `if((window.userUsageData?.plan || 'free').toLowerCase() === 'free') { alert('Upgrade to PRO/PREMIUM plan. Image quality check features are for pro & premium users only.'); if (typeof scrollToPricing === 'function') scrollToPricing(); return; }`;
                const fixButton = `
                          <div style="display: flex; gap: 10px; margin-top: 10px; flex-wrap: wrap;">
                             <button class="ai-fix-btn" style="padding: 6px 14px; background: rgba(37, 99, 235, 0.1); border: 1px solid rgba(37, 99, 235, 0.3); color: #2563EB; border-radius: 8px; font-weight: bold; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 0.85em; transition: 0.2s;" onclick="${clickCheck} fixImageArtifact('${cardId}', '${issue.type.replace(/'/g, "\\'")}')">
                                <i class="fas fa-magic"></i> AI Fix
                             </button>
                             <button class="ai-heal-btn" style="padding: 6px 14px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); color: #10B981; border-radius: 8px; font-weight: bold; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 0.85em; transition: 0.2s;" onclick="${clickCheck} document.getElementById('qualityResultModal').style.display='none'; sendToHealing('${cardId}', ${idx})">
                                <i class="fas fa-eraser"></i> Remove & Heal
                             </button>
                             <button class="ai-denoise-btn" style="padding: 6px 14px; background: rgba(139, 92, 246, 0.1); border: 1px solid rgba(139, 92, 246, 0.3); color: #8B5CF6; border-radius: 8px; font-weight: bold; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 0.85em; transition: 0.2s;" onclick="${clickCheck} document.getElementById('qualityResultModal').style.display='none'; sendToHealing('${cardId}', ${idx})">
                                <i class="fas fa-wand-magic-sparkles"></i> Fix Noise & Blur
                             </button>
                          </div>
                        `;

                reportHtml += `<div class="issue-item" data-index="${idx}" style="background: ${bg}; border-radius: 12px; padding: 15px; margin-bottom: 12px; border: 1px solid ${color}33; display: flex; gap: 15px; align-items: flex-start; transition: 0.2s;">
                                           <div style="background: ${color}22; padding: 8px; border-radius: 10px;">
                                               <i class="fas ${icon}" style="color: ${color}; font-size: 1.1em;"></i>
                                           </div>
                                           <div style="flex: 1;">
                                               <div style="font-weight: 800; color: var(--text-primary); margin-bottom: 2px; font-size: 1em;">${issue.type}</div>
                                               <div style="font-size: 0.85em; color: var(--text-muted); line-height: 1.4;">${issue.description}</div>
                                               ${fixButton}
                                           </div>
                                       </div>`;
            });
        } else {
            reportHtml += `<div style="text-align: center; padding: 30px 15px; background: rgba(16, 185, 129, 0.05); border-radius: 20px; border: 2px dashed rgba(16, 185, 129, 0.2);">
                                       <i class="fas fa-check-circle" style="color: #10B981; font-size: 2.5em; margin-bottom: 15px;"></i>
                                       <div style="color: #10B981; font-weight: 800; font-size: 1.2em; margin-bottom: 5px;">Perfect Quality!</div>
                                       <div style="color: var(--text-muted); font-size: 0.9em;">No technical issues detected.</div>
                                   </div>`;
        }

        reportHtml += `</div></div></div>`;

        body.innerHTML = reportHtml;
        modal.style.display = 'flex';

        // Initialize Heatmap after modal is visible
        setTimeout(() => {
            drawQualityHeatmap(results);
        }, 100);
    }

    function drawQualityHeatmap(results) {
        const canvas = document.getElementById('quality-heatmap-canvas');
        const img = document.getElementById('quality-heatmap-img');
        if (!canvas || !img) return;

        const render = () => {
            const ctx = canvas.getContext('2d');
            canvas.width = img.clientWidth || img.naturalWidth || 500;
            canvas.height = img.clientHeight || img.naturalHeight || 350;

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const issues = results.issues || [];
            issues.forEach(issue => {
                const regions = issue.regions || [];
                const color = issue.severity === 'high' ? '239, 68, 68' : '245, 158, 11';

                regions.forEach(reg => {
                    if (!Array.isArray(reg) || reg.length < 4) return;

                    const x = (reg[0] / 100) * canvas.width;
                    const y = (reg[1] / 100) * canvas.height;
                    const w = ((reg[2] - reg[0]) / 100) * canvas.width;
                    const h = ((reg[3] - reg[1]) / 100) * canvas.height;

                    // Draw a soft glowing rectangle or circle
                    const gradient = ctx.createRadialGradient(
                        x + w / 2, y + h / 2, 0,
                        x + w / 2, y + h / 2, Math.max(Math.abs(w), Math.abs(h)) / 1.5
                    );
                    gradient.addColorStop(0, `rgba(${color}, 0.6)`);
                    gradient.addColorStop(1, `rgba(${color}, 0)`);

                    ctx.fillStyle = gradient;
                    ctx.beginPath();
                    ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w) / 1.2, Math.abs(h) / 1.2, 0, 0, Math.PI * 2);
                    ctx.fill();

                    // Inner stronger indicator
                    ctx.strokeStyle = `rgba(${color}, 0.8)`;
                    ctx.lineWidth = 2;
                    ctx.setLineDash([5, 5]);
                    ctx.strokeRect(x, y, w, h);
                });
            });
        }

        if (img.complete) {
            render();
        } else {
            img.onload = render;
        }
    }

    window.fixImageArtifact = async function (cardId, issueType) {
        const modal = document.getElementById('qualityResultModal');
        if (modal) modal.style.display = 'none';

        const card = document.getElementById(cardId);
        const img = card ? card.querySelector('.thumbnail-medium') : null;
        if (!img) return;

        img.classList.add('image-card-fixing');

        // Show notification
        const notify = document.createElement('div');
        notify.style = "position: fixed; top: 20px; right: 20px; background: #10B981; color: white; padding: 12px 24px; border-radius: 12px; z-index: 10000; box-shadow: 0 10px 30px rgba(0,0,0,0.3); font-weight: 700; display: flex; align-items: center; gap: 10px; animation: popIn 0.3s ease-out;";
        notify.innerHTML = `<i class="fas fa-magic fa-spin"></i> AI is fixing ${issueType}...`;
        document.body.appendChild(notify);

        try {
            // Small delay to show off the cool animation
            await new Promise(r => setTimeout(r, 1500));

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;

            // Apply filters for enhancement
            const issueLower = issueType.toLowerCase();
            let needsCustomSharpen = false;

            if (issueLower.includes('saturate') || issueLower.includes('saturation') || issueLower.includes('over-saturated') || issueLower.includes('color')) {
                // Correct over-saturation by reducing saturation levels
                ctx.filter = 'saturate(0.7) contrast(1.05)';
            } else if (issueLower.includes('over-exposure') || issueLower.includes('overexposure') || issueLower.includes('overexposed') || issueLower.includes('blown highlights') || issueLower.includes('too bright')) {
                // Correct over-exposure: reduce brightness, balance contrast and saturation
                ctx.filter = 'brightness(0.82) contrast(1.12) saturate(0.95)';
            } else if (issueLower.includes('under-exposure') || issueLower.includes('underexposure') || issueLower.includes('underexposed') || issueLower.includes('dark')) {
                // Correct under-exposure: lift brightness, adjust contrast
                ctx.filter = 'brightness(1.25) contrast(1.08) saturate(1.05)';
            } else if (issueLower.includes('exposure') || issueLower.includes('light')) {
                // Generic exposure adjustment
                ctx.filter = 'brightness(0.9) contrast(1.1)';
            } else if (issueLower.includes('blur') || issueLower.includes('sharpness') || issueLower.includes('focus')) {
                // Apply basic adjustment, then trigger custom sharpening convolution
                ctx.filter = 'contrast(1.1) brightness(1.02)';
                needsCustomSharpen = true;
            } else if (issueLower.includes('noise') || issueLower.includes('grain')) {
                // Subtle blur followed by contrast boost to reduce grain
                ctx.filter = 'blur(0.5px) contrast(1.12) saturate(1.05)';
            } else if (issueLower.includes('compression') || issueLower.includes('jpeg')) {
                // Smooth out blocks slightly
                ctx.filter = 'blur(0.4px) contrast(1.1) saturate(1.05)';
            } else if (issueLower.includes('banding')) {
                // Blend bands slightly
                ctx.filter = 'blur(0.3px) saturate(1.15) contrast(1.05)';
            } else if (issueLower.includes('aberration') || issueLower.includes('fringe')) {
                // Desaturate slightly to reduce color fringing impact
                ctx.filter = 'saturate(0.9) contrast(1.1)';
            } else {
                // General enhancement for AI artifacts, watermarks, etc.
                ctx.filter = 'contrast(1.1) saturate(1.1)';
            }

            ctx.drawImage(img, 0, 0);

            // Perform high-speed custom 3x3 Laplacian sharpening for blur issues
            if (needsCustomSharpen) {
                try {
                    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const d = imgData.data;
                    const comp = new Uint8ClampedArray(d);
                    const strength = 0.65; // Adjust sharpening effect strength (0.0 to 1.0)
                    const w = canvas.width;

                    for (let i = w * 4; i < d.length - w * 4; i += 4) {
                        // Skip edge pixels to avoid out-of-bounds errors
                        if (i % (w * 4) === 0 || (i + 4) % (w * 4) === 0) continue;

                        const r = comp[i] * 5 - (comp[i - 4] + comp[i + 4] + comp[i - w * 4] + comp[i + w * 4]);
                        const g = comp[i + 1] * 5 - (comp[i - 3] + comp[i + 5] + comp[i + 1 - w * 4] + comp[i + 1 + w * 4]);
                        const b = comp[i + 2] * 5 - (comp[i - 2] + comp[i + 6] + comp[i + 2 - w * 4] + comp[i + 2 + w * 4]);

                        d[i] = comp[i] + (r - comp[i]) * strength;
                        d[i + 1] = comp[i + 1] + (g - comp[i + 1]) * strength;
                        d[i + 2] = comp[i + 2] + (b - comp[i + 2]) * strength;
                    }
                    ctx.putImageData(imgData, 0, 0);
                } catch (e) {
                    console.error("Custom sharpening convolution failed:", e);
                }
            }

            const fixedDataUrl = canvas.toDataURL('image/jpeg', 0.95);
            img.src = fixedDataUrl;

            // Update local file data
            const fileData = uploadedFilesData.find(f => f.id === cardId);
            if (fileData) {
                const blob = await (await fetch(fixedDataUrl)).blob();
                fileData.previewFile = new File([blob], fileData.name, { type: 'image/jpeg' });
                // If it's a standard image, update base file too
                if (!fileData.isAiFile) fileData.fileObject = fileData.previewFile;
            }

            notify.innerHTML = `<i class="fas fa-check-circle"></i> ${issueType} Optimized Successfully!`;
            setTimeout(() => notify.style.opacity = '0', 2000);
            setTimeout(() => notify.remove(), 2500);

            // Re-run quality check to show improvement
            setTimeout(() => {
                checkImageQualityFromBtn(cardId);
            }, 500);

        } catch (error) {
            console.error("Enhancement failed:", error);
            notify.style.background = "#EF4444";
            notify.innerHTML = `<i class="fas fa-exclamation-circle"></i> Failed to fix artifacts.`;
            setTimeout(() => notify.remove(), 3000);
        } finally {
            img.classList.remove('image-card-fixing');
        }
    };

    // --- ADD MORE BUTTON LOGIC ---
    const addMoreFilesBtn = document.getElementById('addMoreFilesButton');
    if (addMoreFilesBtn) {
        addMoreFilesBtn.onclick = function () {
            const uploadSection = document.querySelector('.file-upload-section');
            if (uploadSection) {
                uploadSection.style.display = 'flex'; // Or 'block' depending on original CSS, 'flex' matches .file-upload-section CSS 
                // Optionally scroll to it
                uploadSection.scrollIntoView({ behavior: 'smooth' });
                // Hide this button again? Or keep it? User didn't specify, but usually "Add More" implies opening the dialog or showing the dropzone.
                // Showing the dropzone makes sense.
                this.style.display = 'none';
            }
        };
    }

    // --- ACTION BUTTONS ---
    if (clearAllButton) {
        clearAllButton.onclick = function () {
            uploadedFilesData = [];
            previewContainer.innerHTML = '';
            updateAllButtonStates();

            if (typeof window.SessionDB !== 'undefined') window.SessionDB.clearSession();

            // Show upload section again on Clear All
            const uploadSection = document.querySelector('.file-upload-section');
            const addMoreBtn = document.getElementById('addMoreFilesButton');
            if (uploadSection) uploadSection.style.display = 'flex';
            if (addMoreBtn) addMoreBtn.style.display = 'none';
        };
    }

    // Add test metadata button functionality
    const testMetadataButton = document.getElementById('testMetadataButton');
    if (testMetadataButton) {
        testMetadataButton.onclick = testMetadataCompatibility;
    }

    // ===== BULK SELECTION FEATURE =====

    // Handle checkbox state changes
    window.handleCheckboxChange = function () {
        const checkedBoxes = document.querySelectorAll('.bulk-checkbox:checked');
        const count = checkedBoxes.length;
        const bulkActionBar = document.getElementById('bulkActionBar');
        const selectedCountEl = document.getElementById('selectedCount');

        if (count > 0) {
            bulkActionBar.style.display = 'flex';
            selectedCountEl.textContent = count;
        } else {
            bulkActionBar.style.display = 'none';
        }
    };

    // Get all selected card IDs
    function getSelectedCards() {
        const checkedBoxes = document.querySelectorAll('.bulk-checkbox:checked');
        const cardIds = [];
        checkedBoxes.forEach(checkbox => {
            cardIds.push(checkbox.dataset.fileId);
        });
        return cardIds;
    }

    // Delete selected files
    window.deleteSelectedFiles = function () {
        const selectedCardIds = getSelectedCards();

        if (selectedCardIds.length === 0) {
            alert('No files selected');
            return;
        }

        const confirmMsg = `Are you sure you want to delete ${selectedCardIds.length} selected file(s)?`;
        if (!confirm(confirmMsg)) {
            return;
        }

        selectedCardIds.forEach(cardId => {
            const card = document.getElementById(cardId);
            if (card) {
                // Remove from uploadedFilesData array
                const index = uploadedFilesData.findIndex(f => f.id === cardId);
                if (index !== -1) {
                    uploadedFilesData.splice(index, 1);
                }

                // Remove card from DOM
                card.remove();
            }
        });

        // Update UI
        handleCheckboxChange();
        updateAllButtonStates();

        // Show upload section if no files left
        if (uploadedFilesData.length === 0) {
            const uploadSection = document.querySelector('.file-upload-section');
            const addMoreBtn = document.getElementById('addMoreFilesButton');
            if (uploadSection) uploadSection.style.display = 'flex';
            if (addMoreBtn) addMoreBtn.style.display = 'none';
        }

        alert(`${selectedCardIds.length} file(s) deleted successfully`);
    };

    // Download selected files with embedded metadata
    window.downloadSelectedFiles = async function () {
        const selectedCardIds = getSelectedCards();

        if (selectedCardIds.length === 0) {
            alert('No files selected');
            return;
        }

        // Filter to get only files with metadata
        const filesToDownload = uploadedFilesData.filter(f =>
            selectedCardIds.includes(f.id) &&
            f.title &&
            f.title !== "Error" &&
            (
                (f.fileObject.type && (f.fileObject.type === 'image/jpeg' || f.fileObject.type === 'image/jpg')) ||
                (f.fileObject.type && f.fileObject.type === 'image/png') ||
                (f.name && f.name.toLowerCase().endsWith('.png')) ||
                (f.fileObject.type && f.fileObject.type === 'image/svg+xml') ||
                (f.name && f.name.toLowerCase().endsWith('.svg')) ||
                (f.name && f.name.toLowerCase().endsWith('.eps'))
            )
        );

        if (filesToDownload.length === 0) {
            alert('No selected files with metadata to download. Please generate metadata first.');
            return;
        }

        const downloadBtn = document.querySelector('.bulk-action-btn.download-btn');
        const originalHTML = downloadBtn.innerHTML;
        downloadBtn.disabled = true;
        downloadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + getTrans('downloading');

        let downloadedCount = 0;

        for (const fileData of filesToDownload) {
            try {
                if (
                    (fileData.fileObject.type && (fileData.fileObject.type === 'image/jpeg' || fileData.fileObject.type === 'image/jpg'))
                ) {
                    await embedAndDownload(fileData);
                } else if (
                    (fileData.fileObject.type && fileData.fileObject.type === 'image/png') ||
                    (fileData.name && fileData.name.toLowerCase().endsWith('.png'))
                ) {
                    await embedPngAndDownload(fileData);
                } else if (
                    (fileData.fileObject.type && fileData.fileObject.type === 'image/svg+xml') ||
                    (fileData.name && fileData.name.toLowerCase().endsWith('.svg'))
                ) {
                    await embedSvgAndDownload(fileData);

                } else if (
                    (fileData.name && fileData.name.toLowerCase().endsWith('.eps'))
                ) {
                    await embedEpsAndDownload(fileData);
                }

                downloadedCount++;
                downloadBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${getTrans('downloading')} ${downloadedCount}/${filesToDownload.length}`;
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                console.error(`Failed to download ${fileData.name}`, error);
            }
        }

        downloadBtn.disabled = false;
        downloadBtn.innerHTML = originalHTML;
        alert(`${downloadedCount} file(s) downloaded successfully`);
    };

    // Translate selected files
    window.translateSelectedFiles = async function () {
        const selectedCardIds = getSelectedCards();

        if (selectedCardIds.length === 0) {
            alert('No files selected');
            return;
        }

        // Filter to get only cards with metadata
        const cardsWithMetadata = selectedCardIds.filter(cardId => {
            const fileData = uploadedFilesData.find(f => f.id === cardId);
            return fileData && fileData.title && fileData.title !== "Error";
        });

        if (cardsWithMetadata.length === 0) {
            alert('No selected files with metadata to translate. Please generate metadata first.');
            return;
        }

        // Ask user for target language
        const targetLang = prompt(
            'Select target language:\n' +
            'es = Spanish, fr = French, de = German, ja = Japanese,\n' +
            'pt = Portuguese, it = Italian, bn = Bengali, hi = Hindi,\n' +
            'ar = Arabic, zh = Chinese, ko = Korean\n\n' +
            'Enter language code:',
            'es'
        );

        if (!targetLang || targetLang.trim() === '') {
            return;
        }

        const validLanguages = ['es', 'fr', 'de', 'ja', 'pt', 'it', 'bn', 'hi', 'ar', 'zh', 'ko'];
        if (!validLanguages.includes(targetLang.toLowerCase())) {
            alert('Invalid language code. Please try again.');
            return;
        }

        const translateBtn = document.querySelector('.bulk-action-btn.translate-btn');
        const originalHTML = translateBtn.innerHTML;
        translateBtn.disabled = true;
        translateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + getTrans('translating');

        let translatedCount = 0;

        for (const cardId of cardsWithMetadata) {

            // 🌐 Show translate progress bar
            showBatchProgress('translate');
            try {
                // Use existing translateMetadata function logic
                const card = document.getElementById(cardId);
                if (!card) continue;

                const fileData = uploadedFilesData.find(f => f.id === cardId);
                if (!fileData) continue;

                // Translate title
                if (fileData.title) {
                    const translatedTitle = await translateText(fileData.title, targetLang);
                    fileData.title = translatedTitle;
                    const titleDiv = card.querySelector('.meta-title');
                    if (titleDiv) titleDiv.textContent = translatedTitle;
                }

                // Translate description
                if (fileData.description) {
                    const translatedDesc = await translateText(fileData.description, targetLang);
                    fileData.description = translatedDesc;
                    const descDiv = card.querySelector('.meta-description');
                    if (descDiv) descDiv.textContent = translatedDesc;
                }

                // Translate keywords
                if (fileData.keywords && fileData.keywords.length > 0) {
                    const translatedKeywords = [];
                    for (const keyword of fileData.keywords) {
                        const translatedKeyword = await translateText(keyword, targetLang);
                        translatedKeywords.push(translatedKeyword);
                    }
                    fileData.keywords = translatedKeywords.join(', ');

                    // Update keywords display
                    updateKeywordsDisplay(cardId);
                }

                translatedCount++;
                translateBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Translating... ${translatedCount}/${cardsWithMetadata.length}`;
                updateBatchProgress(translatedCount, cardsWithMetadata.length, fileData ? fileData.name : cardId, 'translate');
                await new Promise(resolve => setTimeout(resolve, 800)); // Delay to avoid API rate limits
            } catch (error) {
                console.error(`Failed to translate card ${cardId}`, error);
            }
        }

        translateBtn.disabled = false;
        translateBtn.innerHTML = originalHTML;
        hideBatchProgress(true);
        alert(`${translatedCount} file(s) translated successfully to ${targetLang.toUpperCase()}`);
    };

    // Update closeCard function to handle checkbox state
    window.closeCard = function (button) {
        const card = button.closest('.file-preview-card');
        if (!card) return;

        const cardId = card.id;

        // Remove from uploadedFilesData
        const index = uploadedFilesData.findIndex(f => f.id === cardId);
        if (index !== -1) {
            uploadedFilesData.splice(index, 1);
        }

        // Remove card from DOM
        card.remove();

        // Update bulk action bar if it was checked
        handleCheckboxChange();

        // Update button states
        updateAllButtonStates();

        // Show upload section if no files left
        if (uploadedFilesData.length === 0) {
            const uploadSection = document.querySelector('.file-upload-section');
            const addMoreBtn = document.getElementById('addMoreFilesButton');
            if (uploadSection) uploadSection.style.display = 'flex';
            if (addMoreBtn) addMoreBtn.style.display = 'none';
        }
    };

    // Generate Metadata ONLY for Selected Files
    window.generateMetadataForSelected = async function () {
        const selectedCardIds = getSelectedCards();

        if (selectedCardIds.length === 0) {
            alert('No files selected');
            return;
        }

        // Filter files based on selection from the global uploadedFilesData
        const filesToProcess = uploadedFilesData.filter(f => selectedCardIds.includes(f.id));

        if (filesToProcess.length === 0) {
            alert("Selected files not found in data.");
            return;
        }

        // AI processes directly through Supabase Edge Functions. No client-side keys needed.

        // UI Feedback on the button
        const btn = document.querySelector('.bulk-action-btn.process-btn');
        const originalContent = btn.innerHTML;
        btn.disabled = true;

        // Reset Pause State
        window.isPaused = false;
        const pauseBtn = document.getElementById('pauseProcessButton');
        if (pauseBtn) {
            pauseBtn.style.display = 'inline-flex';
            pauseBtn.innerHTML = '<i class="fas fa-pause"></i> ' + (typeof getTrans === 'function' ? getTrans('pause') : 'Pause');
            pauseBtn.classList.remove('green-button');
            pauseBtn.classList.add('orange-button');
        }

        let processedCount = 0;
        let completedCount = 0;
        let errorCount = 0;
        let totalFiles = filesToProcess.length;

        // Loop through selected files
        for (const fileData of filesToProcess) {
            // Check for pause
            while (window.isPaused) {
                await new Promise(r => setTimeout(r, 200));
            }

            processedCount++;
            btn.innerHTML = `<i class="icon-spinner"></i> ${getTrans('processing')} ${processedCount}/${totalFiles}`;
            updateBatchProgress(processedCount, totalFiles, fileData.name, 'generate');

            const currentCard = document.getElementById(fileData.id);
            if (currentCard) currentCard.style.borderColor = "#F97316"; // Active color

            try {
                // Generate Metadata
                const metadata = await generateMetadata(fileData);

                // Update Data
                fileData.title = metadata.title;
                fileData.keywords = metadata.keywords;
                fileData.description = metadata.description || '';

                // Update UI specific elements if needed (usually generateMetadata handles internal UI)
                const epsBtn = document.getElementById(`btn-eps-${fileData.id}`);
                if (epsBtn) epsBtn.disabled = false;

                completedCount++;
                if (currentCard) currentCard.style.borderColor = "#10B981"; // Success color

            } catch (error) {
                console.error("Error processing file:", fileData.name, error);
                fileData.title = "Error"; // Mark as error so it can be retried later
                errorCount++;
                if (currentCard) {
                    currentCard.style.borderColor = "#EF4444"; // Error color
                    const metaTitle = currentCard.querySelector('.meta-title');
                    if (metaTitle) metaTitle.textContent = "Failed: " + error.message;
                }
            }

            // Delay for API Rate Limits on backend
            await new Promise(resolve => setTimeout(resolve, 1500));
        }

        // Finish Process
        btn.innerHTML = `<i class="fas fa-check"></i> ${getTrans('done')} (${completedCount}/${totalFiles})`;
        hideBatchProgress(errorCount === 0);

        // Hide pause button
        if (pauseBtn) pauseBtn.style.display = 'none';

        // Notification
        if (Notification.permission === "granted") {
            new Notification("Selected Batch Complete! ✅", {
                body: `Success: ${completedCount}, Failed: ${errorCount}`,
                icon: "https://cdn-icons-png.flaticon.com/512/148/148767.png"
            });
        } else {
            // Small delay to let user see the button text
            setTimeout(() => {
                alert(`Batch Generation Complete!\nSuccess: ${completedCount}\nFailed: ${errorCount}`);
            }, 500);
        }

        if (completedCount > 0 && !localStorage.getItem('feedbackSubmitted')) {
            setTimeout(() => {
                const feedbackModal = document.getElementById('feedbackModal');
                if (feedbackModal) {
                    feedbackModal.style.display = 'flex';
                }
            }, 3000);
        }

        // Reset Button after 2 seconds
        setTimeout(() => {
            btn.disabled = false;
            btn.innerHTML = originalContent;
        }, 2000);
    };

    // ===== TRANSLATION FEATURE =====

    // Translation using free MyMemory API (no API key required)
    async function translateText(text, targetLang) {
        if (!text || text.trim() === '') return text;

        try {
            const encodedText = encodeURIComponent(text);
            const url = `https://api.mymemory.translated.net/get?q=${encodedText}&langpair=en|${targetLang}`;

            const response = await fetch(url);
            const data = await response.json();

            if (data.responseStatus === 200 && data.responseData) {
                return data.responseData.translatedText;
            } else {
                throw new Error('Translation failed');
            }
        } catch (error) {
            console.error('Translation error:', error);
            return text; // Return original text if translation fails
        }
    }

    // Batch translate all processed files
    const batchTranslateButton = document.getElementById('batchTranslateButton');
    if (batchTranslateButton) {
        batchTranslateButton.onclick = async function () {
            const targetLang = document.getElementById('translationLanguageSelect').value;

            if (targetLang === 'none') {
                alert('Please select a target language from the sidebar first.');
                return;
            }

            // Filter files that have metadata but not yet translated
            const filesToTranslate = uploadedFilesData.filter(f => f.title && f.title !== "Error");

            if (filesToTranslate.length === 0) {
                alert('No files with metadata to translate. Please generate metadata first.');
                return;
            }

            this.disabled = true;
            let processedCount = 0;
            let successCount = 0;
            let errorCount = 0;

            for (const fileData of filesToTranslate) {
                processedCount++;

                // Update button text with progress
                this.innerHTML = `<i class="fas fa-language"></i> Translating ${processedCount}/${filesToTranslate.length}...`;

                try {
                    // Translate title
                    if (fileData.title) {
                        fileData.translatedTitle = await translateText(fileData.title, targetLang);
                    }

                    // Translate description
                    if (fileData.description) {
                        fileData.translatedDescription = await translateText(fileData.description, targetLang);
                    }

                    // Translate keywords (split, translate each, rejoin)
                    if (fileData.keywords) {
                        const keywordsArray = fileData.keywords.split(',').map(k => k.trim());
                        const translatedKeywordsArray = [];

                        for (const keyword of keywordsArray) {
                            const translated = await translateText(keyword, targetLang);
                            translatedKeywordsArray.push(translated);
                            // Small delay to avoid rate limiting
                            await new Promise(resolve => setTimeout(resolve, 300));
                        }

                        fileData.translatedKeywords = translatedKeywordsArray.join(', ');
                    }

                    fileData.targetLanguage = targetLang;
                    successCount++;

                    // Update the metadata card to show translated content
                    updateMetadataCardWithTranslation(fileData);

                    // 📊 Log activity and update usage
                    logActivity('Batch Translate', {
                        fileName: fileData.name,
                        targetLang: targetLang
                    });

                } catch (error) {
                    console.error(`Translation failed for ${fileData.name}:`, error);
                    errorCount++;
                }

                // Delay between files to respect API rate limits
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            // Reset button
            this.disabled = false;
            this.innerHTML = '<i class="fas fa-language"></i> ' + getTrans('batch_translate');

            // Show completion message
            alert(`Translation Complete!\nSuccess: ${successCount}\nFailed: ${errorCount}`);
        };
    }

    // Function to update metadata card with translated content
    function updateMetadataCardWithTranslation(fileData) {
        const card = document.getElementById(fileData.id);
        if (!card) return;

        const metaTitle = card.querySelector('.meta-title');
        const metaDescription = card.querySelector('.meta-description');
        const metaKeywords = card.querySelector('.meta-keywords');

        // Add toggle button if not already present
        let toggleBtn = card.querySelector('.translation-toggle-btn');
        if (!toggleBtn && fileData.translatedTitle) {
            toggleBtn = document.createElement('button');
            toggleBtn.className = 'translation-toggle-btn';
            toggleBtn.innerHTML = '<i class="fas fa-exchange-alt"></i> ' + getTrans('view_translated');
            toggleBtn.style.cssText = 'margin: 10px 0; padding: 5px 10px; background: linear-gradient(90deg, #8B5CF6 60%, #6D28D9 100%); color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85em;';

            let showingTranslation = false;

            toggleBtn.onclick = function () {
                showingTranslation = !showingTranslation;

                if (showingTranslation) {
                    // Show translated version
                    if (metaTitle) metaTitle.textContent = fileData.translatedTitle || fileData.title;
                    if (metaDescription) metaDescription.textContent = fileData.translatedDescription || fileData.description;
                    if (metaKeywords) metaKeywords.textContent = fileData.translatedKeywords || fileData.keywords;
                    this.innerHTML = '<i class="fas fa-exchange-alt"></i> ' + getTrans('view_original');
                } else {
                    // Show original version
                    if (metaTitle) metaTitle.textContent = fileData.title;
                    if (metaDescription) metaDescription.textContent = fileData.description;
                    if (metaKeywords) metaKeywords.textContent = fileData.keywords;
                    this.innerHTML = '<i class="fas fa-exchange-alt"></i> ' + getTrans('view_translated');
                }
            };

            // Insert toggle button after title
            if (metaTitle && metaTitle.parentNode) {
                metaTitle.parentNode.insertBefore(toggleBtn, metaTitle.nextSibling);
            }
        }
    }

    // ===== BATCH PROGRESS BAR HELPERS =====
    let _bpStartTime = 0;

    const _bpStages = {
        generate: { icon: '⚙️', label: 'Generating Metadata' },
        translate: { icon: '🌐', label: 'Translating Files' },
        prompt: { icon: '✨', label: 'Processing Prompts' }
    };

    function showBatchProgress(stage) {
        const overlay = document.getElementById('batchProgressOverlay');
        const fill = document.getElementById('bpFill');
        if (!overlay) return;
        const s = _bpStages[stage] || _bpStages.generate;
        document.getElementById('bpStageIcon').textContent = s.icon;
        document.getElementById('bpStageLabel').textContent = s.label;
        document.getElementById('bpChip').textContent = '0 / 0';
        document.getElementById('bpChip').className = 'bp-chip';
        document.getElementById('bpPct').textContent = '0%';
        document.getElementById('bpPct').className = 'bp-pct';
        document.getElementById('bpEta').textContent = '';
        document.getElementById('bpFilename').innerHTML = '⏳ Initializing...';
        if (fill) { fill.style.width = '0%'; fill.className = 'batch-progress-fill running'; }
        overlay.style.display = 'block';
        // Smooth scroll to it
        overlay.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        _bpStartTime = Date.now();
    }

    function updateBatchProgress(current, total, filename, stage) {
        const overlay = document.getElementById('batchProgressOverlay');
        const fill = document.getElementById('bpFill');
        if (!overlay || overlay.style.display === 'none') return;

        const pct = total > 0 ? Math.round((current / total) * 100) : 0;

        // Fill bar
        if (fill) fill.style.width = pct + '%';

        // Chip
        const chip = document.getElementById('bpChip');
        if (chip) chip.textContent = `${current} / ${total} files`;

        // Percentage
        const pctEl = document.getElementById('bpPct');
        if (pctEl) pctEl.textContent = pct + '%';

        // ETA
        const etaEl = document.getElementById('bpEta');
        if (etaEl && current > 0) {
            const elapsed = (Date.now() - _bpStartTime) / 1000;
            const perFile = elapsed / current;
            const remaining = Math.round(perFile * (total - current));
            if (remaining > 0) {
                etaEl.textContent = remaining < 60
                    ? `~${remaining}s remaining`
                    : `~${Math.ceil(remaining / 60)}m remaining`;
            } else {
                etaEl.textContent = 'Almost done...';
            }
        }

        // Filename
        const fnEl = document.getElementById('bpFilename');
        if (fnEl && filename) {
            const s = _bpStages[stage] || _bpStages.generate;
            fnEl.innerHTML = `${s.icon} Processing: <strong>${filename}</strong>`;
        }
    }

    function hideBatchProgress(success) {
        const overlay = document.getElementById('batchProgressOverlay');
        const fill = document.getElementById('bpFill');
        if (!overlay) return;

        // Final state
        if (fill) { fill.style.width = '100%'; fill.className = 'batch-progress-fill done'; }
        const chip = document.getElementById('bpChip');
        if (chip) chip.className = 'bp-chip done';
        const pctEl = document.getElementById('bpPct');
        if (pctEl) { pctEl.textContent = '100%'; pctEl.className = 'bp-pct done'; }
        const etaEl = document.getElementById('bpEta');
        if (etaEl) etaEl.textContent = '';
        const fnEl = document.getElementById('bpFilename');
        if (fnEl) fnEl.innerHTML = success !== false
            ? '✅ All done! Results are ready below.'
            : '⚠️ Finished with some errors. Check cards above.';

        // Auto-hide after 3.5s
        setTimeout(() => {
            overlay.style.opacity = '0';
            setTimeout(() => {
                overlay.style.display = 'none';
                overlay.style.opacity = '';
            }, 420);
        }, 3500);
    }
    // ===== END BATCH PROGRESS BAR HELPERS =====

    if (processAllButton) {
        // Global Pause State
        window.isPaused = false;
        window.togglePause = function () {
            window.isPaused = !window.isPaused;
            const btn = document.getElementById('pauseProcessButton');
            if (btn) {
                if (window.isPaused) {
                    btn.innerHTML = '<i class="fas fa-play"></i> ' + getTrans('resume');
                    btn.classList.add('green-button');
                    btn.classList.remove('orange-button');
                } else {
                    btn.innerHTML = '<i class="fas fa-pause"></i> ' + getTrans('pause');
                    btn.classList.remove('green-button');
                    btn.classList.add('orange-button');
                }
            }
        };

        async function processSelectedFiles() {
            // 🟠 IMMEDIATE UI FEEDBACK
            processAllButton.disabled = true;
            processAllButton.innerHTML = '<i class="icon-spinner"></i> ' + (typeof getTrans === 'function' ? getTrans('processing') : 'Processing...');
            showBatchProgress('generate');

            // 🔔 Request Notification Permission
            if (Notification.permission !== "granted") {
                Notification.requestPermission();
            }

            const selectedProvider = document.getElementById('aiProviderSelect')?.value || 'groq';
            const user = auth.currentUser;

            // Filter files to process
            const filesToProcess = uploadedFilesData.filter(f => !f.title || f.title === "");

            if (filesToProcess.length === 0) {
                alert("All files have already been processed.");
                processAllButton.disabled = false;
                processAllButton.innerHTML = '<i class="icon-process"></i> ' + (typeof getTrans === 'function' ? getTrans('process_selected') : 'Process Selected');
                hideBatchProgress();
                return;
            }

            // Check plan and usage
            let usage = { count: 0, limit: 10 };
            let isProPremium = false;

            if (user) {
                try {
                    const [profileDoc, usageData] = await Promise.all([
                        db.collection('users').doc(user.email).get(),
                        getMetadataUsage(user.email)
                    ]);

                    const profileData = profileDoc.exists ? profileDoc.data() : null;
                    const dbPlan = (profileData?.plan || '').toLowerCase();
                    isProPremium = (dbPlan === 'pro' || dbPlan === 'premium' || dbPlan === 'agency');
                    usage = usageData;
                } catch (e) {
                    console.warn('Initial data check failed', e);
                }
            } else {
                try {
                    usage = await getMetadataUsage("unknown");
                } catch (e) {
                    console.warn('Anonymous usage check failed', e);
                }
            }

            // 🛑 LIMIT CHECK
            if (usage.count + filesToProcess.length > usage.limit) {
                const remaining = usage.limit - usage.count;
                if (!user) {
                    if (remaining <= 0) {
                        showLimitModal(`Your lifetime login-free free trial has expired (3/3 images processed). Please sign in to continue & get 10 more free credits!`);
                    } else {
                        showLimitModal(`You have only <strong>${remaining}</strong> login-free trial image(s) left for this device. You selected <strong>${filesToProcess.length}</strong> images. Please reduce the number or sign in to get 10 more free credits.`);
                    }
                } else {
                    if (remaining <= 0) {
                        showLimitModal(`Your daily limit has been reached. Please try again tomorrow or upgrade.`);
                    } else {
                        showLimitModal(`You have only <strong>${remaining}</strong> images left for today. You selected <strong>${filesToProcess.length}</strong> images. Please reduce the number or upgrade to Pro.`);
                    }
                }
                processAllButton.disabled = false;
                processAllButton.innerHTML = '<i class="icon-process"></i> ' + (typeof getTrans === 'function' ? getTrans('process_selected') : 'Process Selected');
                hideBatchProgress();
                return;
            }

            // Reset pause state and show button
            window.isPaused = false;
            const pauseBtn = document.getElementById('pauseProcessButton');
            if (pauseBtn) {
                pauseBtn.style.display = 'inline-flex';
                pauseBtn.innerHTML = '<i class="fas fa-pause"></i> ' + (typeof getTrans === 'function' ? getTrans('pause') : 'Pause');
                pauseBtn.classList.remove('green-button');
                pauseBtn.classList.add('orange-button');
            }

            let totalFiles = filesToProcess.length;
            let processedCount = 0;
            let completedCount = 0;
            let errorCount = 0;

            // 🚀 SUPER FAST CONCURRENCY LOGIC (Dynamic Speed)
            // Mistral স্লো তাই একসাথে ১টি, বাকিগুলোর ক্ষেত্রে Pro হলে ৪টি, Free হলে ২টি
            let concurrencyLimit = 2; // Default for Free
            if (isProPremium) {
                concurrencyLimit = (selectedProvider === 'mistral') ? 1 : 4;
            } else {
                concurrencyLimit = (selectedProvider === 'mistral') ? 1 : 2;
            }

            // Chunking / Batching Array
            for (let i = 0; i < filesToProcess.length; i += concurrencyLimit) {
                // Pause Check
                while (window.isPaused) {
                    await new Promise(r => setTimeout(r, 200));
                }

                // Create a chunk of files
                const chunk = filesToProcess.slice(i, i + concurrencyLimit);

                // Process the chunk concurrently using Promise.all
                const chunkPromises = chunk.map(async (fileData) => {
                    const currentCard = document.getElementById(fileData.id);
                    if (currentCard) currentCard.style.borderColor = "#F97316";

                    try {
                        // Live Usage Check
                        const latestUsage = await getMetadataUsage(authUser?.email || "unknown");
                        if (latestUsage.count >= latestUsage.limit) {
                            throw new Error("Daily limit reached");
                        }

                        // 🧠 Call AI (Concurrent)
                        const metadata = await generateMetadata(fileData);

                        // Save Data
                        fileData.title = metadata.title;
                        fileData.keywords = metadata.keywords;
                        fileData.description = metadata.description || '';

                        const epsBtn = document.getElementById(`btn-eps-${fileData.id}`);
                        if (epsBtn) epsBtn.disabled = false;

                        completedCount++;
                        if (currentCard) currentCard.style.borderColor = "#10B981"; // Success Green

                    } catch (error) {
                        console.error("Error processing file:", fileData.name, error);
                        fileData.title = "Error";
                        errorCount++;
                        if (currentCard) {
                            currentCard.style.borderColor = "#EF4444";
                            const metaTitle = currentCard.querySelector('.meta-title');
                            if (metaTitle) metaTitle.textContent = "Failed: " + error.message;
                        }
                    } finally {
                        processedCount++;
                        // Update UI per file completion
                        const overallCompleted = uploadedFilesData.filter(f => f.title && f.title !== "Error" && f.title !== "").length;
                        const overallErrors = uploadedFilesData.filter(f => f.title === "Error").length;
                        updateProcessButtonText(processedCount, totalFiles, overallCompleted, overallErrors);
                        updateBatchProgress(processedCount, totalFiles, fileData.name, 'generate');
                    }
                });

                // Wait for all 2-4 images in this chunk to finish
                await Promise.all(chunkPromises);

                // ⏱️ Delay between chunks to avoid 429 API Rate Limit
                let delayTime = isProPremium ? 800 : 2500;
                if (selectedProvider === 'mistral') delayTime = 4000;
                await new Promise(resolve => setTimeout(resolve, delayTime));
            }

            // 🏁 Finish Process
            const finalCompleted = uploadedFilesData.filter(f => f.title && f.title !== "Error" && f.title !== "").length;
            const finalErrors = uploadedFilesData.filter(f => f.title === "Error").length;

            // 🔥 Record daily streak activity
            if (finalCompleted > 0 && typeof window.recordStreakActivity === 'function') {
                window.recordStreakActivity();
            }

            updateProcessButtonText(processedCount, totalFiles, finalCompleted, finalErrors, true);
            hideBatchProgress(finalErrors === 0);

            setTimeout(() => {
                processAllButton.disabled = false;
                if (pauseBtn) pauseBtn.style.display = 'none';
            }, 1000);

            // 🔔 Completion Notification
            if (Notification.permission === "granted") {
                new Notification("Metadata Generation Complete! ✅", {
                    body: `Successful: ${finalCompleted}\nFailed: ${finalErrors}`,
                    icon: "https://cdn-icons-png.flaticon.com/512/148/148767.png"
                });
            } else {
                setTimeout(() => {
                    alert(`Batch Generation Complete!\nSuccess: ${finalCompleted}\nFailed: ${finalErrors}`);
                }, 500);
            }

            // Trigger Feedback Modal
            if (finalCompleted > 0 && !localStorage.getItem('feedbackSubmitted')) {
                setTimeout(() => {
                    const feedbackModal = document.getElementById('feedbackModal');
                    if (feedbackModal) feedbackModal.style.display = 'flex';
                }, 2500);
            }
        }


        processAllButton.onclick = async function () {
            if (this.disabled) return;

            try {
                await processSelectedFiles();
            } catch (err) {
                console.error('Processing failed:', err);
            }
        };
    }

    if (processAllPromptsButton) {
        processAllPromptsButton.onclick = async function () {
            // 🟠 IMMEDIATE UI FEEDBACK
            this.disabled = true;
            const originalContent = this.innerHTML;
            this.innerHTML = '<i class="icon-spinner"></i> ' + (typeof getTrans === 'function' ? getTrans('processing') : 'Processing...');

            // --- Check User Plan via profiles table ---
            const user = auth.currentUser;
            const planUser2 = user;

            let isProPremium2 = false;
            if (planUser2) {
                try {
                    const profileDoc2 = await db.collection('users').doc(planUser2.email).get();
                    const profileData2 = profileDoc2.exists ? profileDoc2.data() : null;
                    const dbPlan2 = (profileData2?.plan || '').toLowerCase();
                    isProPremium2 = (dbPlan2 === 'pro' || dbPlan2 === 'premium' || dbPlan2 === 'agency');
                } catch (e) { console.warn('Plan check failed', e); }
            }

            const filesToProcess = uploadedFilesData.filter(f => !f.prompt);
            if (filesToProcess.length === 0) {
                alert("All file prompts have already been generated.");
                this.disabled = false;
                this.innerHTML = originalContent;
                return;
            }

            let totalFiles = filesToProcess.length, processedCount = 0, completedCount = 0, errorCount = 0;

            for (const fileData of filesToProcess) {
                processedCount++;
                updatePromptButtonState(processedCount, totalFiles, completedCount, errorCount);
                const card = document.getElementById(fileData.id);
                const promptSection = card.querySelector('.prompt-section');
                const spinner = promptSection.querySelector('.prompt-spinner');
                const resultContainer = promptSection.querySelector('.prompt-result-container');
                const realDiv = card.querySelector(`#prompt-realistic-${fileData.id}`);
                const illDiv = card.querySelector(`#prompt-illustration-${fileData.id}`);
                const tdDiv = card.querySelector(`#prompt-3d-${fileData.id}`);

                card.classList.add('prompt-generated');
                resultContainer.style.display = 'none';
                spinner.style.display = 'block';
                /* logActivity is now handled server-side */
                try {
                    const promptResult = await generatePromptForImage(fileData.fileObject);
                    fileData.prompt = promptResult;

                    // Attempt to parse JSON response for three styles
                    let promptObj = null;
                    try {
                        const cleanedJson = promptResult.replace(/^```json\s*|\s*```$/gi, '').trim();
                        promptObj = JSON.parse(cleanedJson);
                    } catch (e) {
                        console.warn("Failed to parse prompt response as JSON. Falling back to single prompt.", e);
                    }

                    if (promptObj && promptObj.realistic && promptObj.illustration && promptObj["3d"]) {
                        realDiv.textContent = promptObj.realistic;
                        illDiv.textContent = promptObj.illustration;
                        tdDiv.textContent = promptObj["3d"];
                        realDiv.style.color = '';
                        illDiv.style.color = '';
                        tdDiv.style.color = '';
                    } else {
                        // Fallback: put raw text in Realistic, and styled variations in the others
                        realDiv.textContent = promptResult;
                        illDiv.textContent = `${promptResult} (Illustration style)`;
                        tdDiv.textContent = `${promptResult} (3D style)`;
                        realDiv.style.color = '';
                        illDiv.style.color = '';
                        tdDiv.style.color = '';
                    }

                    resultContainer.style.display = 'block';
                    completedCount++;
                } catch (error) {
                    fileData.prompt = `Error: ${error.message}`;
                    if (realDiv) {
                        realDiv.textContent = `Error: ${error.message}`;
                        realDiv.style.color = '#EF4444';
                    }
                    if (illDiv) {
                        illDiv.textContent = `Error: ${error.message}`;
                        illDiv.style.color = '#EF4444';
                    }
                    if (tdDiv) {
                        tdDiv.textContent = `Error: ${error.message}`;
                        tdDiv.style.color = '#EF4444';
                    }
                    resultContainer.style.display = 'block';
                    errorCount++;
                } finally {
                    spinner.style.display = 'none';
                    const overallCompleted = uploadedFilesData.filter(f => f.prompt && !f.prompt.startsWith("Error")).length;
                    const overallErrors = uploadedFilesData.filter(f => f.prompt && f.prompt.startsWith("Error")).length;
                    updatePromptButtonState(processedCount, totalFiles, overallCompleted, overallErrors);
                    await new Promise(resolve => setTimeout(resolve, 1100));
                }
            }
            const finalCompleted = uploadedFilesData.filter(f => f.prompt && !f.prompt.startsWith("Error")).length;
            const finalErrors = uploadedFilesData.filter(f => f.prompt && f.prompt.startsWith("Error")).length;
            updatePromptButtonState(processedCount, totalFiles, finalCompleted, finalErrors, true);
            this.disabled = false;
        };
    }

    if (embedMetadataButton) {
        embedMetadataButton.onclick = async function () {
            const plan = (window.userUsageData?.plan || 'free').toLowerCase();
            const trialOk = window.trialPowerPack && window.trialPowerPack.active && window.trialPowerPack.used < window.trialPowerPack.total;
            if (plan === 'free' && !trialOk) {
                alert("Upgrade to PRO/PREMIUM plan. Embed Metadata features are for pro & premium users only.");
                if (typeof scrollToPricing === 'function') scrollToPricing();
                return;
            }
            const filesToEmbed = uploadedFilesData.filter(f =>
                f.title && f.title !== "Error" &&
                (
                    (f.fileObject.type && (f.fileObject.type === 'image/jpeg' || f.fileObject.type === 'image/jpg')) ||
                    (f.fileObject.type && f.fileObject.type === 'image/png') ||
                    (f.name && f.name.toLowerCase().endsWith('.png')) ||
                    (f.fileObject.type && f.fileObject.type === 'image/svg+xml') ||
                    (f.name && f.name.toLowerCase().endsWith('.svg')) ||
                    (f.name && f.name.toLowerCase().endsWith('.eps'))
                )
            );

            if (filesToEmbed.length === 0) {
                alert("No processed JPEG, PNG, SVG, or EPS files with metadata to embed.");
                return;
            }

            this.disabled = true;
            this.innerHTML = '<i class="icon-spinner"></i> Embedding...';
            let embeddedCount = 0;

            for (const fileData of filesToEmbed) {
                try {
                    if (
                        (fileData.fileObject.type && (fileData.fileObject.type === 'image/jpeg' || fileData.fileObject.type === 'image/jpg'))
                    ) {
                        await embedAndDownload(fileData);
                    } else if (
                        (fileData.fileObject.type && fileData.fileObject.type === 'image/png') ||
                        (fileData.name && fileData.name.toLowerCase().endsWith('.png'))
                    ) {
                        await embedPngAndDownload(fileData);
                    }
                    else if (
                        (fileData.fileObject.type && fileData.fileObject.type === 'image/svg+xml') ||
                        (fileData.name && fileData.name.toLowerCase().endsWith('.svg'))
                    ) {
                        await embedSvgAndDownload(fileData);
                    } else if (
                        (fileData.name && fileData.name.toLowerCase().endsWith('.eps'))
                    ) {
                        await embedEpsAndDownload(fileData);
                    }
                    else {
                        console.log(`Skipping embedding for unsupported file: ${fileData.name}`);
                        continue;
                    }

                    embeddedCount++;
                    this.innerHTML = `<i class="icon-spinner"></i> Embedding... ${embeddedCount}/${filesToEmbed.length}`;
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (error) {
                    console.error(`Failed to embed metadata for ${fileData.name}`, error);
                }
            }

            this.innerHTML = `<i class="icon-check"></i> Embedding Complete`;
            setTimeout(() => {
                this.disabled = false;
                this.innerHTML = '<i class="icon-embed"></i> ' + getTrans('embed_metadata');
                alert(`${embeddedCount} file(s) have been downloaded with embedded metadata.`);
            }, 2000);
        }
            ;
    }



    // Helper to sanitize string to ASCII (remove non-ASCII characters)
    function toAscii(str) {
        // Remove any character with code > 127
        return (str || "").replace(/[^\x00-\x7F]/g, "");
    }

    // Helper function to get the correct metadata (translated or original)
    function getMetadataForExport(fileData) {
        return {
            title: fileData.translatedTitle || fileData.title,
            description: fileData.translatedDescription || fileData.description,
            keywords: fileData.translatedKeywords || fileData.keywords,
            // Keep original title as fallback for ASCII fields if needed
            originalTitle: fileData.title
        };
    }

    function concatArrays(arrays) {
        let totalLength = 0;
        for (const arr of arrays) {
            totalLength += arr.length;
        }
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const arr of arrays) {
            result.set(arr, offset);
            offset += arr.length;
        }
        return result;
    }

    function pngCrc32(data) {
        const table = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let k = 0; k < 8; k++) {
                c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
            }
            table[i] = c;
        }
        let crc = -1;
        for (let i = 0; i < data.length; i++) {
            crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xFF];
        }
        return (crc ^ -1) >>> 0;
    }

    function createTextChunk(keyword, text) {
        const keywordBytes = new TextEncoder().encode(keyword);
        // tEXt chunks must be Latin-1. Since TextEncoder produces UTF-8,
        // we sanitize input to ASCII to avoid multi-byte characters breaking parsers.
        // Full unicode is handled by XMP/iTXt.
        const safeText = toAscii(text);
        const textBytes = new TextEncoder().encode(safeText);
        const chunkType = new Uint8Array([116, 69, 88, 116]); // "tEXt"

        const data = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
        data.set(keywordBytes, 0);
        data.set([0], keywordBytes.length);
        data.set(textBytes, keywordBytes.length + 1);

        const lengthBytes = new Uint8Array(4);
        new DataView(lengthBytes.buffer).setUint32(0, data.length, false);

        const typeAndData = concatArrays([chunkType, data]);
        const crc = pngCrc32(typeAndData);
        const crcBytes = new Uint8Array(4);
        new DataView(crcBytes.buffer).setUint32(0, crc, false);

        return concatArrays([lengthBytes, typeAndData, crcBytes]);
    }

    function findIendChunkOffset(uint8Array) {
        let offset = 8;
        const dataView = new DataView(uint8Array.buffer);

        while (offset < uint8Array.length) {
            if (offset + 8 > uint8Array.length) {
                console.error(`Malformed chunk found at offset ${offset}. Not enough data.`);
                return -1;
            }

            const chunkLength = dataView.getUint32(offset, false);

            // Safety check for unreasonable chunk length
            if (chunkLength > uint8Array.length) {
                console.error(`Invalid chunk length ${chunkLength} at offset ${offset}`);
                return -1;
            }

            const chunkTypeBytes = uint8Array.subarray(offset + 4, offset + 8);
            const chunkType = new TextDecoder().decode(chunkTypeBytes);

            if (chunkType === 'IEND') {
                return offset;
            }

            const nextOffset = offset + 12 + chunkLength;

            if (nextOffset > uint8Array.length) {
                return -1;
            }

            offset = nextOffset;
        }
        return -1;
    }

    function createXmpChunk(title, description, keywords) {
        const xmpString = `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:xmp="http://ns.adobe.com/xap/1.0/"
      xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/">
      <dc:title>${title || ""}</dc:title>
      <dc:description>${description || ""}</dc:description>
      <dc:subject>
        ${keywords.split(',').map(k => k.trim()).filter(Boolean).map(k => `<rdf:li>${k}</rdf:li>`).join('\n        ')}
      </dc:subject>
      <xmp:Title>${title || ""}</xmp:Title>
      <xmp:Description>${description || ""}</xmp:Description>
      <photoshop:Headline>${title || ""}</photoshop:Headline>
      <photoshop:Description>${description || ""}</photoshop:Description>
      <photoshop:Keywords>
        ${keywords.split(',').map(k => k.trim()).filter(Boolean).map(k => `<rdf:li>${k}</rdf:li>`).join('\n        ')}
      </photoshop:Keywords>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>`;

        const keyword = "XML:com.adobe.xmp";
        const keywordBytes = new TextEncoder().encode(keyword);
        const nullSeparator = new Uint8Array([0]);
        const compressionFlag = new Uint8Array([0]);
        const compressionMethod = new Uint8Array([0]);
        const langTag = new Uint8Array([]);
        const translatedKeyword = new Uint8Array([]);
        const xmpBytes = new TextEncoder().encode(xmpString);

        const data = concatArrays([
            keywordBytes, nullSeparator, compressionFlag, compressionMethod, nullSeparator, nullSeparator, xmpBytes
        ]);
        const chunkType = new Uint8Array([105, 84, 88, 116]); // "iTXt"
        const lengthBytes = new Uint8Array(4);
        new DataView(lengthBytes.buffer).setUint32(0, data.length, false);
        const typeAndData = concatArrays([chunkType, data]);
        const crc = pngCrc32(typeAndData);
        const crcBytes = new Uint8Array(4);
        new DataView(crcBytes.buffer).setUint32(0, crc, false);
        return concatArrays([lengthBytes, typeAndData, crcBytes]);
    }

    async function embedPngAndDownload(fileData) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const arrayBuffer = e.target.result;
                const metadata = getMetadataForExport(fileData);

                const workerCode = `
                            // Helper to sanitize string to ASCII
                            function toAscii(str) {
                                return (str || "").replace(/[^\\x00-\\x7F]/g, "");
                            }

                            function concatArrays(arrays) {
                                let totalLength = 0;
                                for (const arr of arrays) {
                                    totalLength += arr.length;
                                }
                                const result = new Uint8Array(totalLength);
                                let offset = 0;
                                for (const arr of arrays) {
                                    result.set(arr, offset);
                                    offset += arr.length;
                                }
                                return result;
                            }

                            function pngCrc32(data) {
                                const table = new Uint32Array(256);
                                for (let i = 0; i < 256; i++) {
                                    let c = i;
                                    for (let k = 0; k < 8; k++) {
                                        c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
                                    }
                                    table[i] = c;
                                }
                                let crc = -1;
                                for (let i = 0; i < data.length; i++) {
                                    crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xFF];
                                }
                                return (crc ^ -1) >>> 0;
                            }

                            function createTextChunk(keyword, text) {
                                const keywordBytes = new TextEncoder().encode(keyword);
                                const safeText = toAscii(text);
                                const textBytes = new TextEncoder().encode(safeText);
                                const chunkType = new Uint8Array([116, 69, 88, 116]); // "tEXt"

                                const data = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
                                data.set(keywordBytes, 0);
                                data.set([0], keywordBytes.length);
                                data.set(textBytes, keywordBytes.length + 1);

                                const lengthBytes = new Uint8Array(4);
                                new DataView(lengthBytes.buffer).setUint32(0, data.length, false);

                                const typeAndData = concatArrays([chunkType, data]);
                                const crc = pngCrc32(typeAndData);
                                const crcBytes = new Uint8Array(4);
                                new DataView(crcBytes.buffer).setUint32(0, crc, false);

                                return concatArrays([lengthBytes, typeAndData, crcBytes]);
                            }

                            function findIendChunkOffset(uint8Array) {
                                let offset = 8;
                                const dataView = new DataView(uint8Array.buffer);

                                while (offset < uint8Array.length) {
                                    if (offset + 8 > uint8Array.length) {
                                        return -1;
                                    }

                                    const chunkLength = dataView.getUint32(offset, false);

                                    if (chunkLength > uint8Array.length) {
                                        return -1;
                                    }

                                    const chunkTypeBytes = uint8Array.subarray(offset + 4, offset + 8);
                                    const chunkType = new TextDecoder().decode(chunkTypeBytes);

                                    if (chunkType === 'IEND') {
                                        return offset;
                                    }

                                    const nextOffset = offset + 12 + chunkLength;

                                    if (nextOffset > uint8Array.length) {
                                        return -1;
                                    }

                                    offset = nextOffset;
                                }
                                return -1;
                            }

                            function createXmpChunk(title, description, keywords) {
                                const xmpString = \`<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:xmp="http://ns.adobe.com/xap/1.0/"
      xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/">
      <dc:title>\${title || ""}</dc:title>
      <dc:description>\${description || ""}</dc:description>
      <dc:subject>
        \${keywords.split(',').map(k => k.trim()).filter(Boolean).map(k => \`<rdf:li>\${k}</rdf:li>\`).join('\\n        ')}
      </dc:subject>
      <xmp:Title>\${title || ""}</xmp:Title>
      <xmp:Description>\${description || ""}</xmp:Description>
      <photoshop:Headline>\${title || ""}</photoshop:Headline>
      <photoshop:Description>\${description || ""}</photoshop:Description>
      <photoshop:Keywords>
        \${keywords.split(',').map(k => k.trim()).filter(Boolean).map(k => \`<rdf:li>\${k}</rdf:li>\`).join('\\n        ')}
      </photoshop:Keywords>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>\`;

                                const keyword = "XML:com.adobe.xmp";
                                const keywordBytes = new TextEncoder().encode(keyword);
                                const nullSeparator = new Uint8Array([0]);
                                const compressionFlag = new Uint8Array([0]);
                                const compressionMethod = new Uint8Array([0]);
                                const langTag = new Uint8Array([]);
                                const translatedKeyword = new Uint8Array([]);
                                const xmpBytes = new TextEncoder().encode(xmpString);

                                const data = concatArrays([
                                    keywordBytes, nullSeparator, compressionFlag, compressionMethod, nullSeparator, nullSeparator, xmpBytes
                                ]);
                                const chunkType = new Uint8Array([105, 84, 88, 116]); // "iTXt"
                                const lengthBytes = new Uint8Array(4);
                                new DataView(lengthBytes.buffer).setUint32(0, data.length, false);
                                const typeAndData = concatArrays([chunkType, data]);
                                const crc = pngCrc32(typeAndData);
                                const crcBytes = new Uint8Array(4);
                                new DataView(crcBytes.buffer).setUint32(0, crc, false);
                                return concatArrays([lengthBytes, typeAndData, crcBytes]);
                            }

                            self.onmessage = function(e) {
                                try {
                                    const { arrayBuffer, metadata } = e.data;
                                    const originalBytes = new Uint8Array(arrayBuffer);
                                    const iendOffset = findIendChunkOffset(originalBytes);
                                    if (iendOffset === -1) {
                                        throw new Error("Could not find IEND chunk. The PNG file might be corrupt.");
                                    }
                                    const contentBeforeIEND = originalBytes.subarray(0, iendOffset);
                                    const iendChunk = originalBytes.subarray(iendOffset);
                                    
                                    const chunksToEmbed = [
                                        createTextChunk("Title", metadata.title || ""),
                                        createTextChunk("Description", metadata.description || ""),
                                        createTextChunk("Keywords", metadata.keywords || ""),
                                        createTextChunk("Author", "MetaGen Pro"),
                                        createTextChunk("Software", "MetaGen Pro v5"),
                                        createTextChunk("Subject", metadata.title || ""),
                                        createTextChunk("Comment", metadata.description || ""),
                                        createTextChunk("Copyright", "MetaGen Pro"),
                                        createTextChunk("Creation Time", new Date().toISOString())
                                    ];
                                    const xmpChunk = createXmpChunk(metadata.title || "", metadata.description || "", metadata.keywords || "");
                                    const newPngBytes = concatArrays([contentBeforeIEND, ...chunksToEmbed, xmpChunk, iendChunk]);
                                    
                                    self.postMessage({ success: true, resultBuffer: newPngBytes.buffer }, [newPngBytes.buffer]);
                                } catch (error) {
                                    self.postMessage({ success: false, error: error.message });
                                }
                            };
                        `;

                const workerBlob = new Blob([workerCode], { type: 'application/javascript' });
                const workerUrl = URL.createObjectURL(workerBlob);
                const worker = new Worker(workerUrl);

                worker.onmessage = (e) => {
                    if (e.data.success) {
                        const blob = new Blob([e.data.resultBuffer], { type: 'image/png' });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement("a");
                        link.href = url;
                        link.download = fileData.name.replace(/(\.png)$/i, '_meta$1');
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(url);
                        worker.terminate();
                        URL.revokeObjectURL(workerUrl);
                        resolve();
                    } else {
                        console.error("A critical error occurred during PNG embedding:", e.data.error);
                        alert(`Could not process ${fileData.name}. The file might be corrupt. Check the console for details.`);
                        worker.terminate();
                        URL.revokeObjectURL(workerUrl);
                        reject(new Error(e.data.error));
                    }
                };

                worker.onerror = (err) => {
                    console.error("Worker error:", err);
                    worker.terminate();
                    URL.revokeObjectURL(workerUrl);
                    reject(err);
                };

                worker.postMessage({ arrayBuffer, metadata }, [arrayBuffer]);
            };
            reader.onerror = (err) => {
                console.error("FileReader error:", err);
                reject(err);
            };
            reader.readAsArrayBuffer(fileData.fileObject);
        });
    }


    function createXmpBlock(keywordsArr) {
        const xmp = `\n<x:xmpmeta xmlns:x=\"adobe:ns:meta/\">\n  <rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">\n    <rdf:Description rdf:about=\"\"\n      xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\n      <dc:subject>\n        ${keywordsArr.map(k => `<rdf:li>${k}</rdf:li>`).join('\n')}\n      </dc:subject>\n    </rdf:Description>\n  </rdf:RDF>\n</x:xmpmeta>`;
        return xmp.trim();
    }

    function insertXmpIntoJpeg(dataUrl, xmpString) {
        const encoder = new TextEncoder();
        const xmpPacket = encoder.encode(xmpString);
        const xmpHeader = encoder.encode('http://ns.adobe.com/xap/1.0/\x00');
        const xmpLength = xmpPacket.length + xmpHeader.length + 2;
        const lengthBytes = [(xmpLength >> 8) & 0xFF, xmpLength & 0xFF];
        const xmpSegment = new Uint8Array([0xFF, 0xE1, ...lengthBytes, ...xmpHeader, ...xmpPacket]);
        const binary = atob(dataUrl.split(',')[1]);
        const head = binary.slice(0, 2); // FFD8
        const rest = binary.slice(2);
        let merged = head + String.fromCharCode(...xmpSegment) + rest;
        return dataUrl.split(',')[0] + ',' + btoa(merged);
    }


    // --- NEW: EPS Embedding Function ---
    async function embedEpsAndDownload(fileData) {
        return new Promise(async (resolve, reject) => {
            try {
                const card = document.getElementById(fileData.id);
                let currentTitle = fileData.title || '';
                let currentDesc = fileData.description || '';
                let currentKeywords = fileData.keywords || '';

                // DOM থেকে সর্বশেষ এডিট করা টেক্সটগুলো নেওয়া হচ্ছে
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

                const formData = new FormData();
                formData.append('title', currentTitle);
                formData.append('description', currentDesc);
                formData.append('keywords', currentKeywords);
                formData.append('file', fileData.fileObject); // ফাইল সবসময় শেষে থাকবে

                // আপনার Render সার্ভারের URL
                const response = await fetch('https://metagen-eps-server.onrender.com/api/embed-eps', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    throw new Error("Failed to embed EPS metadata on server.");
                }

                // সার্ভার থেকে আসা এম্বেড করা EPS ফাইলটি ডাউনলোড করা
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = fileData.name.replace(/(\.eps)$/i, '_meta$1');
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);

                resolve();
            } catch (error) {
                console.error("EPS Embed Error:", error);
                reject(error);
            }
        });
    }
    async function embedAndDownload(fileData) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async function (e) {
                try {
                    let imageDataUrl = e.target.result;
                    let exifObj;
                    try {
                        exifObj = piexif.load(imageDataUrl);
                    } catch (err) {
                        imageDataUrl = await new Promise((res, rej) => {
                            const img = new Image();
                            img.onload = () => {
                                const canvas = document.createElement('canvas');
                                canvas.width = img.width; canvas.height = img.height;
                                const ctx = canvas.getContext('2d');
                                ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
                                ctx.drawImage(img, 0, 0);
                                res(canvas.toDataURL('image/jpeg', 0.95));
                            };
                            img.onerror = rej;
                            img.src = e.target.result;
                        });
                    }
                    if (!exifObj) exifObj = { "0th": {}, "Exif": {}, "GPS": {}, "1st": {}, "thumbnail": null };

                    function toUTF16LE(str) {
                        const bytes = [];
                        for (let i = 0; i < str.length; i++) {
                            const code = str.charCodeAt(i);
                            bytes.push(code & 0xff);
                            bytes.push(code >> 8);
                        }
                        bytes.push(0, 0);
                        return bytes;
                    }

                    const metadata = getMetadataForExport(fileData);
                    const keywordsString = (metadata.keywords || "").split(',').map(k => k.trim()).join(';');

                    // ================= FIX START =================

                    if (exifObj["0th"]) {
                        delete exifObj["0th"][piexif.ImageIFD.ImageDescription];
                        delete exifObj["0th"][piexif.ImageIFD.DocumentName];
                    }
                    // ================= FIX END =================

                    exifObj["0th"][piexif.ImageIFD.XPTitle] = toUTF16LE(metadata.title || "");       // Title Column
                    exifObj["0th"][piexif.ImageIFD.XPSubject] = toUTF16LE(metadata.description || ""); // Subject Column
                    exifObj["0th"][piexif.ImageIFD.XPComment] = toUTF16LE(metadata.description || ""); // Comments Column
                    exifObj["0th"][piexif.ImageIFD.XPKeywords] = toUTF16LE(keywordsString);          // Tags Column
                    exifObj["0th"][piexif.ImageIFD.XPAuthor] = toUTF16LE("MetaGen Pro");             // Authors Column

                    const exifBytes = piexif.dump(exifObj);
                    const newImageDataUrl = piexif.insert(exifBytes, imageDataUrl);

                    const keywordsArr = (metadata.keywords || "").split(',').map(k => k.trim()).filter(Boolean);
                    const xmpString = createXmpBlock(keywordsArr);

                    const newImageDataUrlWithXmp = insertXmpIntoJpeg(newImageDataUrl, xmpString);

                    const link = document.createElement("a");
                    link.href = newImageDataUrlWithXmp;
                    link.download = fileData.name.replace(/(\.[\w\d_-]+)$/i, '_meta$1');
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    resolve();
                } catch (error) { reject(error); }
            };
            reader.onerror = reject;
            reader.readAsDataURL(fileData.fileObject);
        });
    }


    function escapeXml(unsafe) {
        return unsafe.replace(/[<>&'"]/g, function (c) {
            switch (c) {
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '&': return '&amp;';
                case '\'': return '&apos;';
                case '"': return '&quot;';
            }
        });
    }

    // ==========================================
    // EPS10 CONVERSION LOGIC (Client-Side)
    // ==========================================

    class EpsConverter {
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
    async function getEpsBlobForFile(fileData) {
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

    function checkBatchEpsButtonState() {
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

    async function embedSvgAndDownload(fileData) {
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

    // Toggle Dropdown Function
    window.toggleExportDropdown = function () {
        const dropdownMenu = document.getElementById('exportDropdownMenu');
        if (dropdownMenu.style.display === 'block') {
            dropdownMenu.style.display = 'none';
        } else {
            dropdownMenu.style.display = 'block';
        }
    };

    // Close dropdown when clicking outside
    window.addEventListener('click', function (event) {
        const dropdownMenu = document.getElementById('exportDropdownMenu');
        const exportBtn = document.getElementById('exportButton');
        // Check if click is outside button and menu
        if (dropdownMenu && exportBtn && !exportBtn.contains(event.target) && !dropdownMenu.contains(event.target)) {
            dropdownMenu.style.display = 'none';
        }
    });

    window.mapShutterstockToAdobe = function (shutterstockCat) {
        if (!shutterstockCat) return "Graphic Resources";
        const s = String(shutterstockCat).toLowerCase();
        if (s.includes("animal")) return "Animals";
        if (s.includes("building") || s.includes("interior")) return "Buildings and Architecture";
        if (s.includes("business")) return "Business";
        if (s.includes("drink")) return "Drinks";
        if (s.includes("nature") || s.includes("park")) return "Landscapes";
        if (s.includes("food")) return "Food";
        if (s.includes("abstract") || s.includes("art") || s.includes("background") || s.includes("texture") || s.includes("object") || s.includes("misc") || s.includes("sign") || s.includes("symbol") || s.includes("vintage")) return "Graphic Resources";
        if (s.includes("beauty") || s.includes("fashion")) return "Lifestyle";
        if (s.includes("celebrity") || s.includes("people")) return "People";
        if (s.includes("education") || s.includes("science") || s.includes("health") || s.includes("medical")) return "Science";
        if (s.includes("holiday") || s.includes("religion")) return "Culture and Religion";
        if (s.includes("industrial")) return "Industry";
        if (s.includes("sport") || s.includes("recreation")) return "Sports";
        if (s.includes("technology")) return "Technology";
        if (s.includes("transport")) return "Transport";
        return "Graphic Resources";
    };

    window.getMappedAdobeCategory = function (catName) {
        const map = {
            "Animals": "1",
            "Buildings and Architecture": "2",
            "Business": "3",
            "Drinks": "4",
            "Environment": "5",
            "States of Mind": "6",
            "Food": "7",
            "Graphic Resources": "8",
            "Hobbies and Leisure": "9",
            "Industry": "10",
            "Landscapes": "11",
            "Lifestyle": "12",
            "People": "13",
            "Plants and Flowers": "14",
            "Culture and Religion": "15",
            "Science": "16",
            "Social Issues": "17",
            "Sports": "18",
            "Technology": "19",
            "Transport": "20",
            "Travel": "21"
        };
        return map[catName] || "8";
    };

    window.exportAllCsv = function (targetPlatform) {
        const successfulFiles = uploadedFilesData.filter(f => f.title && f.title !== "Error");
        if (successfulFiles.length === 0) {
            alert("No successful metadata to export.");
            return;
        }

        let platformToUse = targetPlatform;
        if (!platformToUse) {
            const activePlatformBtn = document.querySelector('.platform-button.active');
            platformToUse = activePlatformBtn ? activePlatformBtn.dataset.platform : '';
        }

        let csvContent = '';
        let isShutterstock = (platformToUse === 'shutterstock');
        let isAdobe = (platformToUse === 'adobe');

        if (isShutterstock) {
            csvContent += "Filename,Description,Keywords,Categories,Releases\n";
            successfulFiles.forEach(fileData => {
                const title = fileData.title || "";
                const keywords = fileData.keywords || "";
                // Use AI-detected category per file
                const categoryValue = (fileData.category || "").replace(/"/g, '""');

                const fileName = fileData.name.replace(/"/g, '""');
                const descriptionAsTitle = title.replace(/"/g, '""');
                const keywordsEscaped = keywords.replace(/"/g, '""');
                const releases = (fileData.releases || []).map(r => r.name).join('; ').replace(/"/g, '""');
                csvContent += `"${fileName}","${descriptionAsTitle}","${keywordsEscaped}","${categoryValue}","${releases}"\n`;
            });
            alert("Shutterstock CSV generated! AI-detected categories are included in the 'Categories' column. Upload this CSV to Shutterstock — categories will be auto-filled!");

        } else if (isAdobe) {
            csvContent += "Filename,Title,Keywords,Category,Releases\n";
            successfulFiles.forEach(fileData => {
                const title = fileData.title || "";
                const keywords = fileData.keywords || "";

                const catSelect = document.getElementById(`ai-category-${fileData.id}`);
                const adobeCat = getMappedAdobeCategory(catSelect ? catSelect.value : (fileData.adobeCategory || ''));
                const categoryValue = adobeCat.replace(/"/g, '""');

                const fileName = fileData.name.replace(/"/g, '""');
                const descriptionAsTitle = title.replace(/"/g, '""');
                const keywordsEscaped = keywords.replace(/"/g, '""');
                const releases = (fileData.releases || []).map(r => r.name).join('; ').replace(/"/g, '""');
                csvContent += `"${fileName}","${descriptionAsTitle}","${keywordsEscaped}","${categoryValue}","${releases}"\n`;
            });
            alert("Adobe Stock CSV generated! AI-detected categories are included in the 'Category' column. Upload this CSV to Adobe Stock — categories will be auto-filled!");

        } else {
            csvContent += "Filename,Title,Keywords,Description,Category,Releases\n";
            successfulFiles.forEach(fileData => {
                const originalFileName = fileData.name.replace(/"/g, '""');
                const title = (fileData.title || "").replace(/"/g, '""');
                const keywords = (fileData.keywords || "").replace(/"/g, '""');
                const description = (fileData.description || "").replace(/"/g, '""');

                const catSelect = document.getElementById(`ai-category-${fileData.id}`);
                const adobeCat = getMappedAdobeCategory(catSelect ? catSelect.value : (fileData.adobeCategory || ''));
                const categoryValue = adobeCat.replace(/"/g, '""');
                const releases = (fileData.releases || []).map(r => r.name).join('; ').replace(/"/g, '""');

                csvContent += `"${originalFileName}","${title}","${keywords}","${description}","${categoryValue}","${releases}"\n`;
            });
        }

        const fileName = platformToUse ? `${platformToUse}_metadata.csv` : "metadata_export.csv";
        const encodedUri = "data:text/csv;charset=utf-8," + encodeURIComponent(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", fileName);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Hide dropdown
        const dm = document.getElementById('exportDropdownMenu');
        if (dm) dm.style.display = 'none';
    };

    window.exportAllExcel = async function () {
        const user = auth.currentUser;
        const userEmail = user?.email;
        let currentPlan = 'free';

        if (userEmail) {
            const usage = await getMetadataUsage(userEmail);
            currentPlan = (usage.plan || 'free').toLowerCase();
            // Sync global state
            if (window.userUsageData) window.userUsageData.plan = currentPlan;
        }

        if (currentPlan === 'free') {
            openUpgradeModal('pro');
            return;
        }

        const successfulFiles = uploadedFilesData.filter(f => f.title && f.title !== "Error");
        if (successfulFiles.length === 0) {
            alert("No successful metadata to export.");
            return;
        }

        if (typeof XLSX === 'undefined') {
            alert("Excel export library not loaded. Please refresh the page.");
            return;
        }

        const data = successfulFiles.map(fileData => {
            const catSelect = document.getElementById(`ai-category-${fileData.id}`);
            const adobeCat = getMappedAdobeCategory(catSelect ? catSelect.value : (fileData.adobeCategory || ''));
            const releases = (fileData.releases || []).map(r => r.name).join('; ');

            return {
                "File Name": fileData.name,
                "Title": fileData.title || "",
                "Description": fileData.description || "",
                "Keywords": fileData.keywords || "",
                "Shutterstock Category": fileData.category || "",
                "Adobe Category": adobeCat,
                "Releases": releases
            };
        });

        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Metadata");
        XLSX.writeFile(wb, "metadata_export.xlsx");

        // Hide dropdown
        const dm = document.getElementById('exportDropdownMenu');
        if (dm) dm.style.display = 'none';
    };

    // Global Release Form Upload Handler
    window.handleReleaseUpload = function (inputElem, cardId) {
        const files = Array.from(inputElem.files);
        if (!files || files.length === 0) return;

        const fileData = uploadedFilesData.find(f => f.id === cardId);
        if (fileData) {
            fileData.releases = files;
            const listContainer = document.getElementById(`release-files-list-${cardId}`);
            if (listContainer) {
                listContainer.innerHTML = files.map(f => `<i class="fas fa-file-pdf"></i> ${f.name}`).join('<br>');
            }
        }
    };

    // Global CSV Metadata Applier Logic (Pro/Premium Only)
    window.applyCsvMetadata = async function (event) {
        const file = event.target.files[0];
        if (!file) return;

        // Plan Check: Restrict to Pro/Premium (Firebase)
        try {
            const user = auth.currentUser;
            const userEmail = user ? user.email : null;
            let currentPlan = 'free';

            if (userEmail) {
                const usage = await getMetadataUsage(userEmail);
                currentPlan = (usage.plan || 'free').toLowerCase();
                if (window.userUsageData) window.userUsageData.plan = currentPlan;
            }

            if (currentPlan === 'free') {
                event.target.value = '';
                openUpgradeModal('pro');
                return;
            }
        } catch (err) {
            console.warn('Plan check failed for CSV upload:', err);
        }

        const reader = new FileReader();
        reader.onload = function (e) {
            const data = new Uint8Array(e.target.result);
            let workbook;
            try {
                workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const json = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

                let appliedCount = 0;
                json.forEach(row => {
                    // Find filename from common standard CSV headers
                    let filename = row["Filename"] || row["File Name"] || row["File"] || row["Image"] || row["Name"];
                    if (!filename) return;
                    filename = String(filename).trim();

                    const targetFileData = uploadedFilesData.find(f => {
                        if (f.name === filename) return true;
                        const fBase = f.name.substring(0, f.name.lastIndexOf('.')) || f.name;
                        const csvBase = filename.includes('.') ? filename.substring(0, filename.lastIndexOf('.')) : filename;
                        return fBase === csvBase || fBase === filename;
                    });
                    if (targetFileData) {
                        // Extract standard metadata 
                        const title = String(row["Title"] || row["Description"] || "");
                        const desc = String(row["Description"] || row["Title"] || "");
                        const keywords = String(row["Keywords"] || row["Tags"] || "");
                        const category = String(row["Category"] || row["Categories"] || row["Shutterstock Category"] || "");
                        const releasesStr = String(row["Releases"] || "");

                        targetFileData.title = title;
                        targetFileData.description = desc;
                        targetFileData.keywords = keywords;
                        targetFileData.category = category;

                        // Set Adobe Category correctly
                        targetFileData.adobeCategory = mapShutterstockToAdobe(category);

                        // Update Card DOM if available
                        const card = document.getElementById(targetFileData.id);
                        if (card) {
                            card.classList.remove('processing');
                            card.classList.add('metadata-generated');

                            const metaTitle = card.querySelector('.meta-title');
                            if (metaTitle) metaTitle.textContent = title;

                            const metaDesc = card.querySelector('.meta-description');
                            if (metaDesc) metaDesc.textContent = desc;

                            const descSection = document.getElementById(`desc-section-${card.id}`);
                            if (descSection && desc) descSection.style.display = 'block';

                            window.updateKeywordsDisplay(card.id);

                            const catSelect = document.getElementById(`ai-category-${card.id}`);
                            if (catSelect && targetFileData.adobeCategory) {
                                catSelect.value = targetFileData.adobeCategory;
                            }
                        }
                        appliedCount++;
                    }
                });

                alert(`Successfully mapped and applied metadata to ${appliedCount} image(s)!`);
                // Update UI buttons because we now have metadata
                if (typeof updateAllButtonStates === 'function') updateAllButtonStates();
            } catch (error) {
                console.error('Error parsing CSV file:', error);
                alert("Error parsing CSV. Please ensure it's a valid CSV/Excel file.");
            }
        };
        reader.readAsArrayBuffer(file);
        // Reset input for later reuse
        event.target.value = '';
    };

    // (Removed custom keyword DOM update function in favor of native window.updateKeywordsDisplay)

    // Embed Metadata restrict to Pro/Premium (Firebase)
    window.embedMetadata = async function () {
        const user = auth.currentUser;
        const userEmail = user ? user.email : null;
        let currentPlan = 'free';

        if (userEmail) {
            const usage = await getMetadataUsage(userEmail);
            currentPlan = (usage.plan || 'free').toLowerCase();
            // Sync global state
            if (window.userUsageData) window.userUsageData.plan = currentPlan;
        }

        if (currentPlan === 'free') {
            openUpgradeModal('pro');
            return;
        }
        if (typeof embedMetadataAll === 'function') {
            embedMetadataAll();
        }
    };

    // FTP Upload restrict to Premium (Firebase)
    window.openFtpUploadModal = async function () {
        const user = auth.currentUser;
        const userEmail = user ? user.email : null;
        let currentPlan = 'free';

        if (userEmail) {
            const usage = await getMetadataUsage(userEmail);
            currentPlan = (usage.plan || 'free').toLowerCase();
            // Sync global state
            if (window.userUsageData) window.userUsageData.plan = currentPlan;
        }

        if (currentPlan !== 'premium' && currentPlan !== 'agency') {
            openUpgradeModal('premium');
            return;
        }
        const modal = document.getElementById('ftpModal');
        if (modal) {
            modal.style.display = 'flex';
            if (typeof window.handleAgencyConfigChange === 'function') {
                window.handleAgencyConfigChange();
            }
        }
    };
    function testMetadataCompatibility() {
        const testInfo = `
🔍 Metadata Compatibility Test Results:

✅ PNG Files:
- Title: Embedded in tEXt chunk and XMP
- Description: Embedded in tEXt chunk and XMP  
- Keywords: Embedded in tEXt chunk and XMP
- Windows Properties: Should show Title, Subject, Tags
- Adobe Stock: Should show Title and Keywords

✅ JPEG Files:
- Title: Embedded in EXIF and XMP
- Description: Embedded in EXIF and XMP
- Keywords: Embedded in EXIF and XMP
- Windows Properties: Should show Title, Subject, Tags
- Adobe Stock: Should show Title and Keywords

💡 Tips for Best Results:
1. Use descriptive titles (5-15 words)
2. Include relevant keywords (20-35 keywords)
3. Write detailed descriptions (30-50 words)
4. Test files in Windows File Properties
5. Upload to Adobe Stock to verify metadata

⚠️ Note: Some software may display metadata differently.
    `;
        alert(testInfo);
    }

    window.svgFileToPngDataUrl = async function (svgFile, width = 512, height = 512) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(svgFile);
            const img = new Image();
            img.onload = function () {
                const canvas = document.createElement('canvas');
                canvas.width = width; canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = "#fff";
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);
                URL.revokeObjectURL(url);
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = (e) => {
                URL.revokeObjectURL(url);
                reject(e);
            };
            img.src = url;
        });
    };

    function updateAllButtonStates() {
        updateProcessButtonText();
        updatePromptButtonState();
        checkBatchEpsButtonState();
    }

    function updateProcessButtonText(processed = 0, total = 0, completed = 0, errors = 0, isComplete = false) {
        const fileCount = uploadedFilesData.length;
        const hasSuccessfulData = uploadedFilesData.some(f => f.title && f.title !== "Error");

        const hasEmbeddableFiles = uploadedFilesData.some(f =>
            f.title && f.title !== "Error" &&
            (
                f.fileObject.type === 'image/jpeg' ||
                f.fileObject.type === 'image/jpg' ||
                f.fileObject.type === 'image/png' ||
                f.fileObject.type === 'image/svg+xml' ||
                f.name.toLowerCase().endsWith('.svg') ||
                f.name.toLowerCase().endsWith('.eps')
            )
        );

        const translateAllBtn = document.getElementById('translateAllBtn');

        if (fileCount === 0) {
            processAllButton.innerHTML = '<i class="icon-process"></i> ' + getTrans('process_selected');
            processAllButton.disabled = true;
            exportButton.disabled = true;
            embedMetadataButton.disabled = true;
            return;
        }

        const unprocessedFiles = uploadedFilesData.filter(f => !f.title).length;
        processAllButton.disabled = unprocessedFiles === 0 && !isComplete;

        if (isComplete) {
            processAllButton.innerHTML = `<i class="icon-check"></i> ${getTrans('complete')}: ${completed} ${getTrans('success')}, ${errors} ${getTrans('fail')}`;
            processAllButton.style.background = errors === 0 ? 'linear-gradient(90deg, #10B981 60%, #059669 100%)' : 'linear-gradient(90deg, #F97316 60%, #ea580c 100%)';
        } else if (processed > 0) {
            processAllButton.innerHTML = `<i class="icon-spinner"></i> ${getTrans('processing')} ${processed}/${total} | ✓ ${completed} / ✕ ${errors}`;
            processAllButton.disabled = true;
        } else {
            processAllButton.innerHTML = `<i class="icon-process"></i> ${getTrans('process')} ${unprocessedFiles} ${getTrans('files')}`;
            processAllButton.style.background = 'linear-gradient(90deg, #F97316 60%, #ea580c 100%)';
        }

        exportButton.disabled = !hasSuccessfulData;

        // Enable/disable Shutterstock CSV button in platform upload section
        const sstCsvBtn = document.querySelector('.shutterstock-btn');
        if (sstCsvBtn) sstCsvBtn.disabled = !hasSuccessfulData;

        if (translateAllBtn) {
            translateAllBtn.disabled = !hasSuccessfulData;
        }

        embedMetadataButton.disabled = !hasEmbeddableFiles;

        // New Export Buttons Logic
        const saveToFolderBtn = document.getElementById('saveToFolderButton');
        const shareFilesBtn = document.getElementById('shareFilesButton');
        const uploadToDriveBtn = document.getElementById('uploadToDriveButton');
        const ftpPushBtn = document.getElementById('ftpUploadButton');

        if (saveToFolderBtn) saveToFolderBtn.disabled = !hasEmbeddableFiles;
        if (shareFilesBtn) shareFilesBtn.disabled = !hasEmbeddableFiles;
        if (uploadToDriveBtn) uploadToDriveBtn.disabled = !hasEmbeddableFiles;
        if (ftpPushBtn) ftpPushBtn.disabled = !hasEmbeddableFiles;
    }
    function updatePromptButtonState(processed = 0, total = 0, completed = 0, errors = 0, isComplete = false) {
        const fileCount = uploadedFilesData.length;
        if (fileCount === 0) {
            processAllPromptsButton.innerHTML = '<i class="icon-process"></i> Process Prompts';
            processAllPromptsButton.disabled = true;
            return;
        }

        const unprocessedFiles = uploadedFilesData.filter(f => !f.prompt).length;
        processAllPromptsButton.disabled = unprocessedFiles === 0 && !isComplete;

        if (isComplete) {
            processAllPromptsButton.innerHTML = `<i class="icon-check"></i> ${getTrans('complete')}: ${completed} ${getTrans('success')}, ${errors} ${getTrans('fail')}`;
            processAllPromptsButton.style.background = errors === 0 ? 'linear-gradient(90deg, #10B981 60%, #059669 100%)' : 'linear-gradient(90deg, #F97316 60%, #ea580c 100%)';
        } else if (processed > 0) {
            processAllPromptsButton.innerHTML = `<i class="icon-spinner"></i> ${getTrans('processing')} ${processed}/${total} | ✓ ${completed} / ✕ ${errors}`;
            processAllPromptsButton.disabled = true;
        } else {
            processAllPromptsButton.innerHTML = `<i class="icon-process"></i> ${getTrans('process')} ${unprocessedFiles} ${getTrans('prompts')}`;
        }
    }


    const PROHIBITED_WORDS = {
        shutterstock: ["exclusive", "shutterstock"],
        adobe: ["exclusive", "adobe stock", "adobe"],
        Magnific: ["premium", "exclusive", "Magnific"],
        vecteezy: ["exclusive", "vecteezy"],
    };

    // JS - Spam Shield Detection Logic (Pro Feature)
    function checkSpamDuplicates(currentFileData, cardElement, isPaidPlan) {
        if (!currentFileData.title || !currentFileData.keywords) return;

        // Exclude current file from check
        const otherProcessed = uploadedFilesData.filter(f => f.id !== currentFileData.id && f.title && f.keywords && f.title !== 'Error' && f.title !== '');
        if (otherProcessed.length === 0) return;

        let maxTitleSimilarity = 0;
        let maxKeywordOverlap = 0;
        let titleMatchNames = [];
        let keywordMatchNames = [];

        // Helper to calculate jaccard similarity for words
        const getWords = str => str.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2);
        const currentTitleWords = new Set(getWords(currentFileData.title));
        const currentKeywordsArr = currentFileData.keywords.split(',').map(k => k.trim().toLowerCase()).filter(k => k.length > 0);
        const currentKeywords = new Set(currentKeywordsArr);

        otherProcessed.forEach(other => {
            // Check Title
            const otherTitleWords = new Set(getWords(other.title));
            let titleIntersect = Array.from(currentTitleWords).filter(w => otherTitleWords.has(w)).length;
            let titleUnion = new Set([...currentTitleWords, ...otherTitleWords]).size;
            let titleSim = titleUnion === 0 ? 0 : Math.round((titleIntersect / titleUnion) * 100);

            if (titleSim > 70) {
                maxTitleSimilarity = Math.max(maxTitleSimilarity, titleSim);
                titleMatchNames.push(other.name);
            }

            // Check Keywords
            const otherKeywords = new Set(other.keywords.split(',').map(k => k.trim().toLowerCase()).filter(k => k.length > 0));
            let kwIntersect = Array.from(currentKeywords).filter(w => otherKeywords.has(w)).length;
            let kwSim = currentKeywords.size === 0 ? 0 : Math.round((kwIntersect / currentKeywords.size) * 100);

            if (kwSim > 80) {
                maxKeywordOverlap = Math.max(maxKeywordOverlap, kwSim);
                keywordMatchNames.push(other.name);
            }
        });

        if (maxTitleSimilarity > 70 || maxKeywordOverlap > 80) {
            let riskLevel = 'low';
            if (maxKeywordOverlap > 90 || maxTitleSimilarity > 85) riskLevel = 'high';
            else if (maxKeywordOverlap > 80 || maxTitleSimilarity > 70) riskLevel = 'medium';

            // Remove existing spam-shield-warning if any
            const existingWarning = cardElement.querySelector('.spam-shield-warning');
            if (existingWarning) existingWarning.remove();

            const warningBanner = document.createElement('div');
            warningBanner.className = 'spam-shield-warning';

            if (!isPaidPlan) {
                warningBanner.classList.add('pro-feature-locked');
                warningBanner.innerHTML = `<div class="locked-overlay" onclick="typeof showProUpgradeAlert === 'function' ? showProUpgradeAlert() : alert('Please upgrade to Pro')"><div class="lock-icon" title="Pro Feature">🔒</div></div><div class="spam-badge ${riskLevel}">⚠️ Spam Risk Detected</div><div class="spam-details">Upgrade to PRO to view duplicate filenames and analysis details.</div>`;
            } else {
                let detailsHtml = '';
                // unique files only
                titleMatchNames = [...new Set(titleMatchNames)];
                keywordMatchNames = [...new Set(keywordMatchNames)];

                if (maxTitleSimilarity > 70) {
                    detailsHtml += `<div><strong>${typeof getTrans === 'function' ? getTrans('spam_duplicate_title') || 'Duplicate title detected with:' : 'Duplicate title detected with:'}</strong> ${titleMatchNames.slice(0, 2).join(', ')}${titleMatchNames.length > 2 ? ' +' + (titleMatchNames.length - 2) + ' more' : ''} (${maxTitleSimilarity}%)</div>`;
                }
                if (maxKeywordOverlap > 80) {
                    detailsHtml += `<div><strong>${typeof getTrans === 'function' ? getTrans('spam_keyword_overlap') || 'Keyword overlap detected:' : 'Keyword overlap detected:'}</strong> ${keywordMatchNames.slice(0, 2).join(', ')}${keywordMatchNames.length > 2 ? ' +' + (keywordMatchNames.length - 2) + ' more' : ''} (${maxKeywordOverlap}%)</div>`;
                }

                const riskText = riskLevel === 'high' ? 'spam_risk_high' : (riskLevel === 'medium' ? 'spam_risk_medium' : 'spam_risk_low');

                // --- AI FIX BUTTON ---
                const fixBtnHtml = `<button class="action-button blue-button" style="margin-top: 10px; padding: 4px 10px; font-size: 0.85em; width: fit-content;" onclick="fixSpamWithAI('${currentFileData.id}')"><i class="fas fa-magic"></i> AI Fix</button>`;

                warningBanner.innerHTML = `<div class="spam-badge ${riskLevel}">⚠️ ${typeof getTrans === 'function' ? getTrans(riskText) || riskText : riskText}</div><div class="spam-details">${detailsHtml}<div style="margin-top:4px; font-style:italic;">💡 ${typeof getTrans === 'function' ? getTrans('spam_suggestion') || 'Suggestion: Make title/keywords more unique.' : 'Suggestion: Make title/keywords more unique.'}</div>${fixBtnHtml}</div>`;
            }

            const metaCol = cardElement.querySelector('.card-meta-col');
            if (metaCol) {
                metaCol.insertBefore(warningBanner, metaCol.firstChild);
            }
        }
    }

    // JS - Updated generateMetadata Function supporting Mistral
    async function generateMetadata(fileData) {
        const card = document.getElementById(fileData.id);
        const spinner = card.querySelector('.image-spinner');
        const metaCol = card.querySelector('.card-meta-col');
        const metaTitle = card.querySelector('.meta-title');
        const metaDescription = card.querySelector('.meta-description');
        const metaKeywords = card.querySelector('.meta-keywords');
        const descSection = document.getElementById(`desc-section-${card.id}`);
        const styleSection = document.getElementById(`style-section-${card.id}`);
        const moodSection = document.getElementById(`mood-section-${card.id}`);

        // New selectors for container
        const metaStyleContainer = card.querySelector('.meta-style-container');
        const metaMoodContainer = card.querySelector('.meta-mood-container');

        card.classList.add('processing');
        spinner.style.display = 'block';
        metaCol.style.display = 'none';

        const selectedProvider = document.getElementById('aiProviderSelect')?.value || 'groq';

        const minTitle = document.getElementById('minTitleWords')?.value || 10;
        const maxTitle = document.getElementById('maxTitleWords')?.value || 20;
        const minKeywords = document.getElementById('minKeywords')?.value || 35;
        const maxKeywords = document.getElementById('maxKeywords')?.value || 45;
        const minDesc = document.getElementById('minDescWords')?.value || 30;
        const maxDesc = document.getElementById('maxDescWords')?.value || 50;

        const activePlatforms = [...document.querySelectorAll('.platform-button.active')].map(btn => btn.dataset.platform);
        const noDescriptionMode = activePlatforms.includes('adobe') || activePlatforms.includes('Magnific');
        const addSilhouette = document.getElementById('toggleSilhouette')?.checked || false;
        const vectorMode = document.getElementById('toggleVectorMode')?.checked || false;
        const addWhiteBg = document.getElementById('toggleWhiteBg')?.checked || false;
        const addTransparentBg = document.getElementById('toggleTransparentBg')?.checked || false;
        const useTrendingTags = document.getElementById('toggleTrendingTags')?.checked || false;
        const useProhibitedWordsFilter = document.getElementById('toggleProhibitedWords')?.checked || false;
        const singleWordKeywords = document.getElementById('toggleSingleWordKeywords')?.checked || false;
        const useCustomPrompt = document.getElementById('toggleCustomPrompt')?.checked || false;
        const customPromptText = document.getElementById('customPromptText')?.value?.trim() || "";
        const shouldChangeFileName = document.getElementById('toggleChangeFileName')?.checked || false;
        const useFileNameAsTitle = document.getElementById('toggleFileNameAsTitle')?.checked || false;

        let promptText;
        const isCustomTitle = useCustomPrompt && customPromptText;

        if (isCustomTitle) {
            let jsonFields = '"keywords"';
            let descriptionPromptSegment = '';
            if (!noDescriptionMode) {
                jsonFields += ', "description"';
                descriptionPromptSegment = `\n- Description: Generate a concise description STRICTLY between ${minDesc} and ${maxDesc} words. Do not exceed this limit.`;
            }
            let keywordsPromptSegment = `Generate between ${minKeywords} and ${maxKeywords} SEO-friendly keywords based on the subject: "${customPromptText}". Format the output as a JSON array of objects, where each object has a "keyword" (string) and a "score" (integer 0-100 reflecting stock photo potential/relevance). Example: "keywords": [{"keyword": "sunset", "score": 95}, ...]`;
            if (singleWordKeywords) {
                keywordsPromptSegment = `Only generate single-word, SEO-friendly keywords (no phrases) for the subject: "${customPromptText}". Generate between ${minKeywords} and ${maxKeywords} keywords. Format as a JSON array of objects with "keyword" and "score".`;
            }

            // Vector Mode additions
            let vectorModeInstructions = '';
            if (vectorMode) {
                vectorModeInstructions = `\n\nIMPORTANT - VECTOR MODE:\n- This is a vector illustration or logo.\n- Keywords MUST include: "vector illustration", "eps", "svg".\n- Detect and include style keywords like: "flat", "line art", "silhouette", "outline", "minimalist vector".\n- If the image has a plain background, describe it as "isolated on white background".`;
            }

            promptText = `Generate metadata for the subject: "${customPromptText}".\nFormat the output strictly as a JSON object with the keys: ${jsonFields}, "style", "mood", "rejection_prediction", "requires_model_release", "requires_property_release", "is_ai_generated".\n- Keywords: ${keywordsPromptSegment}${descriptionPromptSegment}\n- Style: Detect the photographic style.\n- Mood: Detect the mood of the image.${vectorModeInstructions}\n- Rejection Prediction: Analyze technical quality. Estimate the probability of likely rejection based on technical standards (0-100).\n- requires_model_release: true if the image contains recognizable people/faces, false otherwise.\n- requires_property_release: true if the image contains recognizable private properties, brands, logos, false otherwise.\n- is_ai_generated: true if AI-generated artwork, false otherwise.`;
        } else {
            let titleAddons = [];
            if (addSilhouette) titleAddons.push("Silhouette");
            const titleAddonString = titleAddons.length > 0 ? ` Must include the words: "${titleAddons.join(', ')}".` : '';

            let jsonFields = '"title", "keywords"';
            let descriptionPromptSegment = '';
            if (!noDescriptionMode) {
                jsonFields += ', "description"';
                descriptionPromptSegment = `\n- Description: Generate a detailed description STRICTLY between ${minDesc} and ${maxDesc} words. Do not exceed ${maxDesc} words.`;
            }
            let keywordsPromptSegment = `Generate EXACTLY between ${minKeywords} and ${maxKeywords} SEO-friendly keywords. Format the output as a JSON array of objects, where each object has a "keyword" (string) and a "score" (integer 0-100 reflecting stock photo potential).`;
            if (singleWordKeywords) {
                keywordsPromptSegment = `Only generate single-word, SEO-friendly keywords (no phrases). Generate EXACTLY between ${minKeywords} and ${maxKeywords} keywords. Format as a JSON array of objects with "keyword" and "score".`;
            }

            let vectorModeInstructions = '';
            if (vectorMode) {
                vectorModeInstructions = `\n\nIMPORTANT - VECTOR MODE:\n- This is a vector illustration or logo.\n- Keywords MUST include: "vector illustration", "eps", "svg".\n- Detect and include style keywords like: "flat", "line art", "silhouette", "outline", "minimalist vector".\n- If the image has a plain background, describe it as "isolated on white background".`;
            }

            // --- 🔥 PROMPT FIX FOR CUSTOMIZATION & SEO SCORE ---
            promptText = `Analyze this image and generate highly commercial metadata.\nFormat the output strictly as a JSON object with the keys: ${jsonFields}, "style", "mood", "rejection_prediction", "shutterstock_category", "requires_model_release", "requires_property_release", "is_ai_generated".\n- Title: Generate a highly commercial, SEO-optimized stock photo title. You MUST limit the title strictly between ${minTitle} and ${maxTitle} words. Keep it concise (Ideally 40-70 characters) to maximize SEO score. It MUST include the main subject, Action, and the detected Style and Mood. Do not use colons (:).${titleAddonString}\n- Keywords: ${keywordsPromptSegment}${descriptionPromptSegment}\n- Style: Detect the photographic style (e.g., Cinematic, Minimalist, Vintage).\n- Mood: Detect the mood of the image (e.g., Happy, Melancholic, Energetic).${vectorModeInstructions}\n- Rejection Prediction: Analyze technical quality (focus, lighting, noise, artifacts) for stock photography usage. Estimate probability of rejection (0-100) as integer in 'rejection_prediction'.\n- requires_model_release: true if the image contains recognizable people/faces, false otherwise.\n- requires_property_release: true if the image contains recognizable private properties, modern architecture, brands, logos, or artworks, false otherwise.\n- is_ai_generated: true if the image appears to be an AI-generated artwork (e.g., Midjourney, DALL-E) rather than a real photograph, false otherwise.\n- shutterstock_category: Pick the SINGLE most fitting Shutterstock category from this exact list: Abstract, Animals/Wildlife, Arts, Backgrounds/Textures, Beauty/Fashion, Buildings/Landmarks, Business/Finance, Celebrities, Education, Food and Drink, Healthcare/Medical, Holidays, Industrial, Interiors, Miscellaneous, Nature, Objects, Parks/Outdoor, People, Religion, Science, Signs/Symbols, Sports/Recreation, Technology, Transportation, Vintage. Return only the category name as a string.`;
        }

        // --- PLAN CHECK LOGIC (Firebase) ---
        const user = auth.currentUser;
        let dbPlan = "free";
        let accessToken = "";
        if (user) {
            try {
                accessToken = await user.getIdToken();
                const profileDoc = await db.collection('users').doc(user.email.toLowerCase()).get();
                const profileData = profileDoc.exists ? profileDoc.data() : null;
                dbPlan = (profileData?.plan || '').toLowerCase();
            } catch (e) { console.warn('Plan check failed:', e); }
        }

        if (dbPlan !== 'pro' && dbPlan !== 'premium' && dbPlan !== 'agency') dbPlan = 'free';
        const isPaidPlan = (dbPlan === 'pro' || dbPlan === 'premium' || dbPlan === 'agency');
        const proxyUrl = "https://metagen-pro-api.metagenp.workers.dev/generate";

        // --- ADVANCED VIDEO & SHORT VIDEO PROMPT ENHANCEMENT ---
        if (fileData.isVideo) {
            // Update main prompt context
            promptText = promptText.replace(/Analyze this image/g, "Analyze this stock video footage (represented by a keyframe)");
            promptText = promptText.replace(/this image/g, "this video clip");

            const isShort = fileData.isVertical || fileData.name.toLowerCase().includes('short') || fileData.name.toLowerCase().includes('reel') || fileData.name.toLowerCase().includes('tiktok');
            const orientationTag = isShort ? "VERTICAL (9:16) SHORT VIDEO FORMAT" : "HORIZONTAL (16:9) VIDEO FORMAT";

            // Add advanced video-specific instructions
            const videoInstructions = `\n\nIMPORTANT - ADVANCED VIDEO MODE (${orientationTag}):
- This is a stock video/footage clip. Analyze the keyframe to determine the action, subject, lighting, and cinematic feel.
- You MUST include general video keywords: "footage", "video", "stock footage", "motion", "clip", "b-roll".
${isShort ? '- Since this is a SHORT/VERTICAL video, heavily prioritize keywords for social media algorithms: "shorts", "reels", "tiktok", "vertical", "social media", "mobile format", "trendy".' : '- Include high-quality cinematic keywords if applicable: "cinematic", "4k", "high definition", "widescreen".'}
- The Title MUST be highly engaging, descriptive, and optimized for video buyers. Describe the motion or action vividly (e.g., "Dynamic slow motion of...", "Aerial drone footage of...", "POV shot of...").
- Keep the title SEO-friendly for video searches and ensure keywords accurately describe what is happening in the scene.`;

            promptText += videoInstructions;
        }

        if (useTrendingTags) {
            promptText += `\n\nIMPORTANT - TRENDING TAGS: Act as a stock photography data fetcher. Analyze current trending data for this visual category on Shutterstock and Adobe Stock. Prioritize and inject the most downloaded, highest-selling tags related to this asset strongly into the "keywords" array to maximize commercial sales.`;
        }

        // --- NEW: Advanced Metadata Prompt Enhancement (PRO/PREMIUM ONLY) ---
        if (isPaidPlan) {
            let advancedInstructions = `\n\nIMPORTANT - ADVANCED INSIGHTS:\nAdditionally, provide the following fields in the same JSON object:\n- "commercial_use_cases": Array of 3-5 strings suggesting specific commercial uses (e.g., "website hero banner", "travel brochure").\n- "target_audience": A string describing the ideal market segment or buyer for this image.\n- "color_palette": Analyze dominant colors and provide an array of objects, e.g., [{"hex": "#FF5733", "name": "Vibrant Orange"}]. Max 4 colors.\n- "seo_title_variations": Array of 3 alternative SEO titles (strings) for A/B testing.\n- "long_tail_keywords": Array of 10 long-tail keyword phrases (strings, 3-5 words each).\n- "editorial_caption": A string containing a professional editorial caption suitable for news or publishing.\n- "trending_score": Extract an integer (0-100) reflecting how trendy or in-demand this visual subject is right now.`;

            // Inject the new fields into the structure checking instruction
            promptText = promptText.replace('"requires_property_release", "is_ai_generated"', '"requires_property_release", "is_ai_generated", "commercial_use_cases", "target_audience", "color_palette", "seo_title_variations", "long_tail_keywords", "editorial_caption", "trending_score"');
            promptText += advancedInstructions;
        }


        let base64Image, mimeType;
        let fileToProcess = fileData.fileObject;

        if (fileData.isAiFile) {
            if (fileData.previewFile) {
                fileToProcess = fileData.previewFile;
            } else {
                throw new Error("AI file preview not available. Cannot analyze.");
            }
        }

        mimeType = fileToProcess.type;

        if (mimeType === 'image/svg+xml') {
            const pngDataUrl = await window.svgFileToPngDataUrl(fileToProcess, 512, 512);
            base64Image = pngDataUrl.split(',')[1];
            mimeType = 'image/png';
        } else {
            // Resize image if needed (especially for Groq which has pixel limits)
            // We'll use a max dimension of 2048px which is safe for most Vision APIs
            // Resize image to 1024px for faster processing with all AI models (Gemini, Groq, Mistral)
            const MAX_DIMENSION = 800;

            base64Image = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = new Image();
                    img.onload = () => {
                        let width = img.width;
                        let height = img.height;

                        // Resize if larger than max dimension
                        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
                            if (width > height) {
                                height *= MAX_DIMENSION / width;
                                width = MAX_DIMENSION;
                            } else {
                                width *= MAX_DIMENSION / height;
                                height = MAX_DIMENSION;
                            }

                            const canvas = document.createElement('canvas');
                            canvas.width = width;
                            canvas.height = height;
                            const ctx = canvas.getContext('2d');
                            ctx.drawImage(img, 0, 0, width, height);

                            // High quality JPEG for API
                            resolve(canvas.toDataURL('image/jpeg', 0.9).split(',')[1]);
                            mimeType = 'image/jpeg'; // Update mimetype to JPEG after resize
                        } else {
                            // Use original if small enough
                            resolve(e.target.result.split(',')[1]);
                        }
                    };
                    img.onerror = reject;
                    img.src = e.target.result;
                };
                reader.onerror = error => reject(error);
                reader.readAsDataURL(fileToProcess);
            });
        }

        let generatedText = "";
        let lastError = null;

        try {
            // Retry configuration with Exponential Backoff
            const maxRetries = 3;
            let attempt = 0;
            let fetchSuccess = false;
            let data = null;
            let response = null;

            while (attempt <= maxRetries && !fetchSuccess) {
                try {
                    response = await fetch(proxyUrl, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${accessToken}`
                        },
                        body: JSON.stringify({
                            action: "generate",
                            image: base64Image,
                            mimeType: mimeType,
                            prompt: promptText,
                            provider: selectedProvider,
                            email: user?.email || "unknown",
                            deviceInfo: navigator.userAgent,
                            plan: dbPlan
                        })
                    });

                    data = await response.json();

                    if (!response.ok) {
                        if (response.status === 429) {
                            showLimitModal(data.error);
                            throw new Error("Daily limit reached");
                        }
                        throw new Error(`API Error: ${data.error || response.statusText}`);
                    }
                    fetchSuccess = true;
                } catch (err) {
                    lastError = err;
                    if (err.message === "Daily limit reached") {
                        break; // Stop retrying immediately on limit reach
                    }
                    attempt++;
                    if (attempt <= maxRetries) {
                        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
                        console.warn(`Generation attempt ${attempt} failed. Retrying in ${Math.round(delay)}ms... Error: ${err.message}`);
                        await new Promise(r => setTimeout(r, delay));
                    }
                }
            }

            if (!fetchSuccess) {
                throw lastError || new Error("Failed to generate AI response after multiple attempts.");
            }

            // Update trial UI if applicable
            if (data && data.newCount !== undefined && window.trialUsage) {
                window.trialUsage.count = data.newCount;
                if (typeof updateTrialUI === 'function') updateTrialUI();
            }

            // Parse according to the expected proxy output
            if (data.metadata) {
                generatedText = typeof data.metadata === 'string' ? data.metadata : JSON.stringify(data.metadata);
            } else if (data.text) {
                generatedText = data.text;
            } else if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0]) {
                generatedText = data.candidates[0].content.parts[0].text;
            } else if (data.choices && data.choices[0] && data.choices[0].message) {
                generatedText = data.choices[0].message.content;
            } else {
                generatedText = JSON.stringify(data);
            }

            // Robust JSON Parsing with Error Handling
            let metadata;
            try {
                // Step 1: Remove markdown code blocks
                let cleanedJsonString = generatedText.replace(/^```json\s*|```$/g, '').trim();

                // Step 2: Remove any leading/trailing text that's not JSON
                const jsonStart = cleanedJsonString.indexOf('{');
                const jsonEnd = cleanedJsonString.lastIndexOf('}');
                if (jsonStart !== -1 && jsonEnd !== -1) {
                    cleanedJsonString = cleanedJsonString.substring(jsonStart, jsonEnd + 1);
                }

                // Step 3: Try parsing
                if (
                    !cleanedJsonString ||
                    !cleanedJsonString.trim().startsWith("{")
                ) {
                    throw new Error("AI did not return valid JSON");
                }

                metadata = JSON.parse(cleanedJsonString);

            } catch (parseError) {
                console.error('JSON Parse Error:', parseError);
                console.log('Raw response:', generatedText);

                // Fallback: Try to extract JSON more aggressively
                try {
                    let cleanedJsonString = generatedText
                        .replace(/^```json\s*/gm, '')
                        .replace(/```\s*$/gm, '')
                        .replace(/^[^{]*/, '') // Remove everything before first {
                        .replace(/[^}]*$/, ''); // Remove everything after last }

                    // Fix common JSON issues
                    cleanedJsonString = cleanedJsonString
                        .replace(/[\n\t]/g, ' ') // Replace newlines/tabs with spaces
                        .replace(/\s+/g, ' ') // Normalize whitespace
                        .replace(/,\s*}/g, '}') // Remove trailing commas
                        .replace(/,\s*]/g, ']'); // Remove trailing commas in arrays

                    metadata = JSON.parse(cleanedJsonString)

                    console.log('Successfully parsed with fallback method');

                } catch (fallbackError) {
                    throw new Error(`Failed to parse AI response as JSON. Error: ${parseError.message}. Response: ${generatedText.substring(0, 200)}...`);
                }
            }

            // Custom Title Override
            if (isCustomTitle) { metadata.title = customPromptText; }

            // File Name as Title Logic
            if (useFileNameAsTitle) {
                // Extension remove logic
                const nameWithoutExt = fileData.name.substring(0, fileData.name.lastIndexOf('.')) || fileData.name;
                metadata.title = nameWithoutExt;
            }

            // --- 🔥 FIX: STRICTLY ENFORCE CUSTOMIZATION SLIDER LIMITS ---
            // 1. Force Trim Title if it exceeds user's Max Title Words
            if (!isCustomTitle && metadata.title) {
                let titleWords = metadata.title.split(/\s+/);
                if (titleWords.length > maxTitle) {
                    metadata.title = titleWords.slice(0, maxTitle).join(' ');
                    // Remove any trailing commas or hyphens after trim
                    metadata.title = metadata.title.replace(/[, \-]+$/, '');
                }
            }

            // 2. Force Trim Description if it exceeds user's Max Desc Words
            if (metadata.description) {
                let descWords = metadata.description.split(/\s+/);
                if (descWords.length > maxDesc) {
                    metadata.description = descWords.slice(0, maxDesc).join(' ') + '.';
                }
            }


            // Title Addons
            let finalTitle = metadata.title || "";
            if (addWhiteBg && !finalTitle.toLowerCase().includes("white background")) finalTitle += " isolated on White Background";
            if (addTransparentBg && !finalTitle.toLowerCase().includes("transparent background")) finalTitle += " isolated on Transparent Background";
            metadata.title = finalTitle.replace(/,$/, '').trim();

            // Ensure Advanced Metadata mappings
            if (isPaidPlan) {
                fileData.commercial_use_cases = metadata.commercial_use_cases || [];
                fileData.target_audience = metadata.target_audience || "";
                fileData.color_palette = metadata.color_palette || [];
                fileData.seo_title_variations = metadata.seo_title_variations || [];
                fileData.long_tail_keywords = metadata.long_tail_keywords || [];
                fileData.editorial_caption = metadata.editorial_caption || "";
                fileData.trending_score = metadata.trending_score || 0;
            }

            // Prohibited Words Filter
            if (useProhibitedWordsFilter) {
                let allProhibited = new Set();
                activePlatforms.forEach(p => {
                    if (PROHIBITED_WORDS[p]) PROHIBITED_WORDS[p].forEach(word => allProhibited.add(word.toLowerCase()));
                });
                if (allProhibited.size > 0) {
                    const regex = new RegExp(`\\b(${[...allProhibited].join('|')})\\b`, 'gi');
                    if (metadata.title) metadata.title = metadata.title.replace(regex, '').replace(/\s\s+/g, ' ').trim();
                    if (metadata.keywords) {
                        const filteredKeywords = metadata.keywords.split(',').map(k => k.trim()).filter(k => !allProhibited.has(k.toLowerCase()));
                        metadata.keywords = filteredKeywords.join(', ');
                    }
                }
            }

            // Change File Name
            if (shouldChangeFileName && metadata.title) {
                const originalExtension = fileData.name.slice(fileData.name.lastIndexOf('.'));
                const sanitizedTitle = metadata.title.replace(/[\\/:*?"<>|]/g, '_').trim();
                const newFileName = sanitizedTitle + originalExtension;
                fileData.name = newFileName;
                const cardFileNameElement = card.querySelector('.card-filename');
                if (cardFileNameElement) cardFileNameElement.textContent = newFileName;
            }

            // Update fileData with generated metadata
            fileData.title = metadata.title;

            // Handle Keyword Scores (New Logic)
            // --- FIXED KEYWORD PROCESSING LOGIC ---
            if (Array.isArray(metadata.keywords)) {
                const keywordsList = [];
                fileData.keywordScores = {};

                metadata.keywords.forEach(item => {
                    // Safe checking if item and keyword exist and are strings
                    if (typeof item === 'object' && item !== null && item.keyword && typeof item.keyword === 'string') {
                        const kw = item.keyword.toLowerCase().trim();
                        keywordsList.push(kw);
                        fileData.keywordScores[kw] = item.score || 0;
                    } else if (typeof item === 'string') {
                        const kw = item.toLowerCase().trim();
                        keywordsList.push(kw);
                    }
                });
                fileData.keywords = keywordsList.join(', ');
                metadata.keywords = fileData.keywords;
            } else if (typeof metadata.keywords === 'string') {
                fileData.keywords = metadata.keywords;
                fileData.keywordScores = {};
            } else {
                // Fallback if keywords are missing or invalid
                fileData.keywords = "";
                fileData.keywordScores = {};
            }

            fileData.description = metadata.description;
            fileData.style = metadata.style;
            fileData.mood = metadata.mood;

            // Store AI-detected Shutterstock category
            fileData.category = metadata.shutterstock_category || '';

            // Map to Adobe Stock Category and update UI
            const adobeCatName = mapShutterstockToAdobe(fileData.category);
            fileData.adobeCategory = adobeCatName;
            const aiCategorySelect = document.getElementById(`ai-category-${card.id}`);
            if (aiCategorySelect) {
                aiCategorySelect.value = adobeCatName;
            }

            // Update UI Elements
            metaTitle.textContent = metadata.title;

            // Initial Keyword Display with Remove Buttons
            updateKeywordsDisplay(card.id);

            if (metadata.description && !noDescriptionMode) {
                metaDescription.textContent = metadata.description;
                if (descSection) descSection.style.display = 'block';
            } else {
                metaDescription.textContent = '';
                if (descSection) descSection.style.display = 'none';
            }

            if (metadata.style) {
                // Apply badge style
                metaStyleContainer.innerHTML = `<span class="visual-tag style-tag">${metadata.style}</span>`;
                if (styleSection) styleSection.style.display = 'flex'; // Changed to flex for new CSS
            } else {
                if (styleSection) styleSection.style.display = 'none';
            }

            if (metadata.mood) {
                // Apply badge style
                metaMoodContainer.innerHTML = `<span class="visual-tag mood-tag">${metadata.mood}</span>`;
                if (moodSection) moodSection.style.display = 'flex'; // Changed to flex
            } else {
                if (moodSection) moodSection.style.display = 'none';
            }

            // --- Render Advanced Insights Panel (PRO/PREMIUM Only) ---
            if (isPaidPlan) {
                let advancedPanel = card.querySelector('.advanced-insights-panel');
                const hasAdvancedData = fileData.trending_score || fileData.commercial_use_cases?.length || fileData.target_audience || fileData.seo_title_variations?.length || fileData.long_tail_keywords?.length || fileData.editorial_caption || fileData.color_palette?.length;

                if (hasAdvancedData) {
                    if (!advancedPanel) {
                        advancedPanel = document.createElement('div');
                        advancedPanel.className = 'advanced-insights-panel';
                        advancedPanel.innerHTML = `
                                    <div class="advanced-insights-header" onclick="const c = this.nextElementSibling; c.style.display = c.style.display === 'none' ? 'flex' : 'none'">
                                        <span><i class="fas fa-bolt"></i> Advanced Insights (Pro)</span>
                                        <i class="fas fa-chevron-down"></i>
                                    </div>
                                    <div class="advanced-insights-content" style="display: none;"></div>
                                `;
                        // Insert at the end of metaCol
                        metaCol.appendChild(advancedPanel);
                    }

                    const panelContent = advancedPanel.querySelector('.advanced-insights-content');
                    let contentHTML = '';

                    if (fileData.trending_score) {
                        contentHTML += `<div class="insight-item"><div class="insight-label"><span>📈 Trending Score</span></div><div class="insight-value"><div style="background:var(--bg-input); width:100%; height:8px; border-radius:4px; margin-top:5px; overflow:hidden;"><div style="background:linear-gradient(90deg, #8B5CF6, #EC4899); width:${fileData.trending_score}%; height:100%;"></div></div><div style="font-size:0.8em; margin-top:4px; text-align:right;">${fileData.trending_score}/100</div></div></div>`;
                    }

                    const escapeStr = (str) => (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');

                    if (fileData.commercial_use_cases && fileData.commercial_use_cases.length > 0) {
                        const val = fileData.commercial_use_cases.join(', ');
                        contentHTML += `<div class="insight-item"><div class="insight-label"><span>💼 Commercial Use Cases</span> <button class="copy-btn" onclick="navigator.clipboard.writeText('${escapeStr(val)}'); this.innerHTML='<i class=\\'icon-check\\'></i> Copied'"><i class="icon-copy"></i> Copy</button></div><div class="insight-value">${val}</div></div>`;
                    }

                    if (fileData.target_audience) {
                        contentHTML += `<div class="insight-item"><div class="insight-label"><span>🎯 Target Audience</span> <button class="copy-btn" onclick="navigator.clipboard.writeText('${escapeStr(fileData.target_audience)}'); this.innerHTML='<i class=\\'icon-check\\'></i> Copied'"><i class="icon-copy"></i> Copy</button></div><div class="insight-value">${fileData.target_audience}</div></div>`;
                    }

                    if (fileData.seo_title_variations && fileData.seo_title_variations.length > 0) {
                        const titlesHtml = fileData.seo_title_variations.map(t => `<div style="margin-bottom:4px;">• ${t}</div>`).join('');
                        const val = fileData.seo_title_variations.join('\\n');
                        contentHTML += `<div class="insight-item"><div class="insight-label"><span>📝 A/B Title Variations</span> <button class="copy-btn" onclick="navigator.clipboard.writeText('${escapeStr(val)}'); this.innerHTML='<i class=\\'icon-check\\'></i> Copied'"><i class="icon-copy"></i> Copy</button></div><div class="insight-value">${titlesHtml}</div></div>`;
                    }

                    if (fileData.long_tail_keywords && fileData.long_tail_keywords.length > 0) {
                        const val = fileData.long_tail_keywords.join(', ');
                        contentHTML += `<div class="insight-item"><div class="insight-label"><span>🔑 Long-tail Keywords</span> <button class="copy-btn" onclick="navigator.clipboard.writeText('${escapeStr(val)}'); this.innerHTML='<i class=\\'icon-check\\'></i> Copied'"><i class="icon-copy"></i> Copy</button></div><div class="insight-value">${val}</div></div>`;
                    }

                    if (fileData.editorial_caption) {
                        contentHTML += `<div class="insight-item"><div class="insight-label"><span>📰 Editorial Caption</span> <button class="copy-btn" onclick="navigator.clipboard.writeText('${escapeStr(fileData.editorial_caption)}'); this.innerHTML='<i class=\\'icon-check\\'></i> Copied'"><i class="icon-copy"></i> Copy</button></div><div class="insight-value">${fileData.editorial_caption}</div></div>`;
                    }

                    if (fileData.color_palette && fileData.color_palette.length > 0) {
                        const swatches = fileData.color_palette.map(c => `<span class="color-swatch" style="background:${c.hex || c.color};" title="${c.name || c.hex || c.color}"></span>`).join('');
                        const colorNames = fileData.color_palette.map(c => c.name || c.hex || c.color).join(', ');
                        contentHTML += `<div class="insight-item"><div class="insight-label"><span>🎨 Color Palette</span> <button class="copy-btn" onclick="navigator.clipboard.writeText('${escapeStr(colorNames)}'); this.innerHTML='<i class=\\'icon-check\\'></i> Copied'"><i class="icon-copy"></i> Copy</button></div><div class="insight-value"><div class="color-swatch-container">${swatches}</div><div style="font-size:0.85em; margin-top:5px; color:var(--text-muted);">${colorNames}</div></div></div>`;
                    }

                    panelContent.innerHTML = contentHTML;
                }
            }

            // Update Rejection Predictor
            const rejectionMeter = document.getElementById(`rejection-meter-${card.id}`);
            if (rejectionMeter && metadata.rejection_prediction !== undefined) {
                const rejectionScore = parseInt(metadata.rejection_prediction) || 0;
                const rejectionBadge = document.getElementById(`rejection-badge-${card.id}`);
                const rejectionProgress = document.getElementById(`rejection-progress-${card.id}`);

                const rejectionLock = document.getElementById(`rejection-lock-${card.id}`);

                rejectionMeter.style.display = 'block';

                // Check Plan and Apply Blur
                if (!isPaidPlan) {
                    rejectionMeter.classList.add('pro-feature-locked');
                    if (rejectionLock) rejectionLock.style.display = 'flex';
                } else {
                    rejectionMeter.classList.remove('pro-feature-locked');
                    if (rejectionLock) rejectionLock.style.display = 'none';
                }

                rejectionBadge.textContent = `${rejectionScore}%`;
                rejectionProgress.style.width = `${rejectionScore}%`;

                // Remove old classes
                rejectionBadge.classList.remove('rejection-low', 'rejection-medium', 'rejection-high');
                rejectionProgress.classList.remove('fill-low', 'fill-medium', 'fill-high');

                // Set colors based on risk
                if (rejectionScore < 30) {
                    rejectionBadge.classList.add('rejection-low');
                    rejectionProgress.classList.add('fill-low');
                } else if (rejectionScore < 70) {
                    rejectionBadge.classList.add('rejection-medium');
                    rejectionProgress.classList.add('fill-medium');
                } else {
                    rejectionBadge.classList.add('rejection-high');
                    rejectionProgress.classList.add('fill-high');
                }
            }

            // --- Update Platform Approval Chance ---
            const approvalChanceContainer = document.getElementById(`approval-chance-container-${card.id}`);
            if (approvalChanceContainer && metadata.rejection_prediction !== undefined) {
                const rejectionScore = parseInt(metadata.rejection_prediction) || 0;
                const approvalBase = 100 - rejectionScore;

                // প্রতিটি প্ল্যাটফর্মের জন্য তাদের গাইডলাইন অনুযায়ী ডাইনামিক হিসাব
                // ১. Adobe Stock (কোয়ালিটি এবং আইপি রেগুলেশনে অত্যন্ত কঠোর)
                const adobeChance = Math.max(0, Math.min(100, Math.round(approvalBase * 0.96)));

                // ২. Shutterstock (টাইটেল এবং মেটাডেটা কি-ওয়ার্ড স্প্যামিংয়ের ওপর ভিত্তি করে)
                const totalKeywords = (metadata.keywords || "").split(',').length;
                let shutterPenalty = totalKeywords < 20 ? 5 : 0;
                const shutterChance = Math.max(0, Math.min(100, Math.round(approvalBase - shutterPenalty)));

                // ৩. Freepik (নান্দনিক সৌন্দর্য এবং কমার্শিয়াল ডিমান্ডে অত্যন্ত কঠোর)
                const freepikChance = Math.max(0, Math.min(100, Math.round(approvalBase * 0.92)));

                // মোডাল প্রদর্শন
                approvalChanceContainer.style.display = 'block';

                // ফ্রি এবং পেইড ইউজার লক ফিচার কন্ট্রোল
                const approvalLock = document.getElementById(`approval-lock-${card.id}`);
                if (!isPaidPlan) {
                    approvalChanceContainer.classList.add('pro-feature-locked');
                    if (approvalLock) approvalLock.style.display = 'flex';
                } else {
                    approvalChanceContainer.classList.remove('pro-feature-locked');
                    if (approvalLock) approvalLock.style.display = 'none';
                }

                // ইউআই-তে ডেটা এবং কালার সেট করা
                const setChanceUI = (elementId, score) => {
                    const el = document.getElementById(elementId);
                    if (el) {
                        el.textContent = `${score}%`;
                        if (score >= 80) el.style.color = '#10B981'; // Green
                        else if (score >= 50) el.style.color = '#F59E0B'; // Yellow
                        else el.style.color = '#EF4444'; // Red
                    }
                };

                setChanceUI(`adobe-chance-${card.id}`, adobeChance);
                setChanceUI(`shutter-chance-${card.id}`, shutterChance);
                setChanceUI(`freepik-chance-${card.id}`, freepikChance);
            }

            // Update Release Predictor
            const releaseReqContainer = document.getElementById(`release-req-${card.id}`);
            if (releaseReqContainer && (metadata.requires_model_release !== undefined || metadata.requires_property_release !== undefined)) {
                releaseReqContainer.style.display = 'block';

                if (!isPaidPlan) { // যদি ইউজার ফ্রি হয়
                    releaseReqContainer.classList.add('pro-feature-locked');
                    if (!releaseReqContainer.querySelector('.locked-overlay')) {
                        const lockDiv = document.createElement('div');
                        lockDiv.className = 'locked-overlay';
                        lockDiv.innerHTML = '<div class="lock-icon" title="Pro Feature">🔒</div>';
                        lockDiv.onclick = () => showProUpgradeAlert(); // ক্লিক করলে আপগ্রেড মেসেজ দেখাবে
                        releaseReqContainer.appendChild(lockDiv);
                    }
                } else {
                    releaseReqContainer.classList.remove('pro-feature-locked');
                    const lock = releaseReqContainer.querySelector('.locked-overlay');
                    if (lock) lock.remove();
                }

                const reqModel = document.getElementById(`req-model-${card.id}`);
                const reqProperty = document.getElementById(`req-property-${card.id}`);
                const uploadContainer = document.getElementById(`release-upload-container-${card.id}`);

                let needsUpload = false;

                const isAiGeneratedToggle = document.getElementById('toggleAiGenerated')?.checked || false;
                const isAiImage = fileData.isAiGenerated ||
                    fileData.name.toLowerCase().includes('ai generated') ||
                    fileData.name.toLowerCase().includes('midjourney') ||
                    isAiGeneratedToggle ||
                    metadata.is_ai_generated === true;

                if (metadata.requires_model_release) {
                    if (isAiImage) {
                        reqModel.innerHTML = '<span style="color:#3B82F6; font-weight:bold;">AI 🤖 (No)</span>';
                    } else {
                        reqModel.innerHTML = '<span style="color:#EF4444; font-weight:bold;">Yes ⚠️</span>';
                        needsUpload = true;
                    }
                } else {
                    reqModel.innerHTML = '<span style="color:#10B981;">No</span>';
                }

                if (metadata.requires_property_release) {
                    if (isAiImage) {
                        reqProperty.innerHTML = '<span style="color:#3B82F6; font-weight:bold;">AI 🤖 (No)</span>';
                    } else {
                        reqProperty.innerHTML = '<span style="color:#EF4444; font-weight:bold;">Yes ⚠️</span>';
                        needsUpload = true;
                    }
                } else {
                    reqProperty.innerHTML = '<span style="color:#10B981;">No</span>';
                }

                if (needsUpload) {
                    uploadContainer.style.display = 'block';
                } else {
                    uploadContainer.style.display = 'none';
                }
            }


            card.classList.remove('processing');
            card.classList.add('metadata-generated');
            spinner.style.display = 'none';
            metaCol.style.display = 'flex';

            // Calculate and update SEO Score Meter
            const seoScore = calculateSeoScore(metadata);
            updateSeoMeter(card.id, seoScore);

            // Sort Keywords based on User Preference (High/Med/Low Weight)
            if (metadata.keywords) {
                metadata.keywords = reorderKeywords(metadata.keywords);
            }

            const isAiGeneratedToggle = document.getElementById('toggleAiGenerated')?.checked || false;

            if (isAiGeneratedToggle) {
                let kwArr = metadata.keywords.split(',').map(k => k.trim()).filter(Boolean);

                kwArr = kwArr.filter(k => k.toLowerCase() !== "ai generated" && k.toLowerCase() !== "generative ai");

                kwArr.unshift("ai generated", "generative ai");

                metadata.keywords = kwArr.join(', ');

                if (!fileData.keywordScores) fileData.keywordScores = {};
                fileData.keywordScores["ai generated"] = 100;
                fileData.keywordScores["generative ai"] = 100;
            }

            fileData.keywords = metadata.keywords;

            metaTitle.textContent = metadata.title;
            const clarityBtn = document.getElementById(`check-clarity-btn-${card.id}`);
            if (clarityBtn && metadata.title) {
                clarityBtn.style.display = 'inline-flex';
            }
            updateKeywordsDisplay(card.id);

            // --- NEW: Update Counts ---
            const titleCountElem = document.getElementById(`title-count-${card.id}`);
            if (titleCountElem && metadata.title) {
                const count = metadata.title.split(/\s+/).filter(w => w.length > 0).length;
                titleCountElem.textContent = `(${count})`;
            }

            const descCountElem = document.getElementById(`desc-count-${card.id}`);
            if (descCountElem && metadata.description) {
                const count = metadata.description.split(/\s+/).filter(w => w.length > 0).length;
                descCountElem.textContent = `(${count})`;
            }

            const keywordCountElem = document.getElementById(`keyword-count-${card.id}`);
            if (keywordCountElem && metadata.keywords) {
                const count = metadata.keywords.split(',').filter(k => k.trim()).length;
                keywordCountElem.textContent = `(${count})`;
            }

            fileData.status = 'success';
            if (typeof window.scheduleSessionSave === 'function') {
                window.scheduleSessionSave();
            }

            // 📊 Update Usage Display (Instant local update)
            if (window.userUsageData) {
                window.userUsageData.count = (window.userUsageData.count || 0) + 1;
                window.userUsageData.monthlyCount = (window.userUsageData.monthlyCount || 0) + 1;
                try { updateUsageUI(); } catch (e) { console.warn('Usage UI update failed:', e); }
            }

            // --- Welcome Power-Pack: Track trial credit usage ---
            if (window.trialPowerPack && window.trialPowerPack.active && window.trialPowerPack.used < window.trialPowerPack.total) {
                window.trialPowerPack.used++;
                if (typeof showTrialTip === 'function') showTrialTip(window.trialPowerPack.used, window.trialPowerPack.total);
                if (typeof updateTrialProgressUI === 'function') updateTrialProgressUI();
                if (window.trialPowerPack.used >= window.trialPowerPack.total) {
                    window.trialPowerPack.active = false;
                    if (typeof checkTrialEnded === 'function') checkTrialEnded();
                    if (typeof updateVisibility === 'function') updateVisibility();
                }
            }

            // --- EPS Button Enabling ---
            const epsBtn = document.getElementById(`btn-eps-${card.id}`);
            if (epsBtn && window.userUsageData?.plan === 'premium') {
                epsBtn.disabled = false;
            }
            checkBatchEpsButtonState();

            // --- NEW: 4 Credits Warning Modal ---
            if (window.userUsageData && window.userUsageData.limit) {
                const remaining = window.userUsageData.limit - window.userUsageData.count;
                if (remaining === 4 && !window.hasShownCreditWarning) {
                    window.hasShownCreditWarning = true;
                    const creditModal = document.getElementById('creditWarningModal');
                    if (creditModal) {
                        creditModal.style.display = 'flex';
                    }
                }
            }

            // --- SPAM SHIELD CHECK (Pro Feature) ---
            const spamShieldEnabled = document.getElementById('toggleSpamShield')?.checked || false;
            if (spamShieldEnabled) {
                checkSpamDuplicates(fileData, card, isPaidPlan);
            }

            return metadata;

        } catch (error) {
            console.error("Generation Error:", error);
            card.classList.remove('processing');
            metaTitle.textContent = "Error";
            metaDescription.textContent = error.message;
            metaKeywords.innerHTML = '';
            spinner.style.display = 'none';
            metaCol.style.display = 'flex';
            throw error;
        }
    }

    // SEO Score Calculation Function (Advanced)
    window.calculateSeoScore = function (metadata) {
        let score = 0;
        const maxScore = 100;
        let penalties = 0;
        let suggestions = []; // Each: { text, fixType }

        // 1. Title Length Score (Max 25)
        const title = (metadata.title || '').trim();
        const titleLength = title.length;
        if (titleLength >= 40 && titleLength <= 70) {
            score += 25;
        } else if (titleLength >= 20 && titleLength < 40) {
            score += 20;
            suggestions.push({ text: "💡 Title is short (" + titleLength + " chars). Aim for 40-70 characters.", fixType: null });
        } else if (titleLength > 70 && titleLength <= 100) {
            score += 20;
            suggestions.push({ text: "💡 Title is too long (" + titleLength + " chars). Trim to under 70.", fixType: "trim_title" });
        } else if (titleLength > 100) {
            score += 10;
            suggestions.push({ text: "⚠️ Title is way too long (" + titleLength + " chars). Trim to 40-70.", fixType: "trim_title" });
        } else if (titleLength > 0) {
            score += 10;
            suggestions.push({ text: "⚠️ Title length is sub-optimal. Aim for 40-70 characters.", fixType: null });
        } else {
            penalties += 10;
            suggestions.push({ text: "❌ Missing Title.", fixType: null });
        }

        // 2. Description Length Score (Max 25)
        const desc = (metadata.description || '').trim();
        const descLength = desc.length;
        if (descLength >= 100 && descLength <= 160) {
            score += 25;
        } else if (descLength >= 70 && descLength < 100) {
            score += 20;
            suggestions.push({ text: "💡 Description is short (" + descLength + " chars). Add detail (100-160 ideal).", fixType: null });
        } else if (descLength > 160 && descLength <= 250) {
            score += 20;
            suggestions.push({ text: "💡 Description is long (" + descLength + " chars). Trim to 100-160.", fixType: "trim_desc" });
        } else if (descLength > 250) {
            score += 10;
            suggestions.push({ text: "⚠️ Description is way too long (" + descLength + " chars).", fixType: "trim_desc" });
        } else if (descLength > 0) {
            score += 10;
            suggestions.push({ text: "⚠️ Description length is sub-optimal. Aim for 100-160.", fixType: null });
        } else {
            penalties += 10;
            suggestions.push({ text: "❌ Missing Description.", fixType: null });
        }

        // 3. Keyword Count & Mix Score (Max 50)
        const keywordsRaw = metadata.keywords || '';
        const keywordsArray = (typeof keywordsRaw === 'string' ? keywordsRaw : keywordsRaw.join(',')).split(',').map(k => k.trim()).filter(Boolean);
        const totalKeywords = keywordsArray.length;

        const singleWords = keywordsArray.filter(k => k.split(/\s+/).length === 1).length;
        const twoWords = keywordsArray.filter(k => k.split(/\s+/).length === 2).length;
        const multiWords = keywordsArray.filter(k => k.split(/\s+/).length >= 3).length;

        const pSingle = totalKeywords > 0 ? (singleWords / totalKeywords) * 100 : 0;
        const pTwo = totalKeywords > 0 ? (twoWords / totalKeywords) * 100 : 0;
        const pMulti = totalKeywords > 0 ? (multiWords / totalKeywords) * 100 : 0;

        if (totalKeywords >= 30) {
            score += 20;
        } else if (totalKeywords >= 20) {
            score += 15;
            suggestions.push({ text: "💡 " + totalKeywords + " keywords. Aim for 30+ for max coverage.", fixType: null });
        } else if (totalKeywords >= 10) {
            score += 10;
            suggestions.push({ text: "⚠️ Only " + totalKeywords + " keywords. Add more to cover categories.", fixType: null });
        } else if (totalKeywords > 0) {
            score += 5;
            suggestions.push({ text: "⚠️ Very few keywords (" + totalKeywords + "). 25+ recommended.", fixType: null });
        } else {
            penalties += 20;
            suggestions.push({ text: "❌ Missing Keywords.", fixType: null });
        }

        let mixScore = 0;
        if (pSingle >= 20 && pSingle <= 50) { mixScore += 10; }
        else if (pSingle > 0 && pSingle < 80) { mixScore += 5; suggestions.push({ text: "💡 Balance single-word keywords (" + Math.round(pSingle) + "%, target 20-50%).", fixType: null }); }
        if (pTwo >= 30 && pTwo <= 60) { mixScore += 10; }
        else if (pTwo > 10) { mixScore += 5; suggestions.push({ text: "💡 Add more two-word phrases (" + Math.round(pTwo) + "% now, target 30-60%).", fixType: null }); }
        if (pMulti >= 10 && pMulti <= 40) { mixScore += 10; }
        else if (pMulti > 0 && pMulti < 60) { mixScore += 5; suggestions.push({ text: "💡 Insert 3+ word long-tail phrases (" + Math.round(pMulti) + "% now, target 10-40%).", fixType: null }); }
        score += mixScore;

        // 4. Quality Checks & Penalties
        const uniqueKeywords = new Set(keywordsArray.map(k => k.toLowerCase()));
        if (uniqueKeywords.size < totalKeywords) {
            const duplicatesCount = totalKeywords - uniqueKeywords.size;
            penalties += duplicatesCount * 2;
            suggestions.push({ text: "❌ " + duplicatesCount + " duplicate keyword(s) found.", fixType: "remove_duplicates" });
        }

        if (titleLength > 0 && title.toLowerCase() === desc.toLowerCase()) {
            penalties += 20;
            suggestions.push({ text: "❌ Title and description are identical.", fixType: null });
        }

        const titleWords = title.toLowerCase().split(/\s+/);
        const titleWordCounts = {};
        titleWords.forEach(w => { if (w.length > 3) titleWordCounts[w] = (titleWordCounts[w] || 0) + 1; });
        if (Object.values(titleWordCounts).some(c => c > 3)) {
            penalties += 10;
            suggestions.push({ text: "⚠️ Keyword stuffing in title (repeated words).", fixType: "fix_title_stuffing" });
        }

        let finalScore = score - penalties;
        return {
            score: Math.max(0, Math.min(100, finalScore)),
            suggestions: suggestions
        };
    }

    // SEO Score Meter Update Function
    window.updateSeoMeter = function (cardId, seoData) {
        const meterContainer = document.getElementById(`seo-meter-${cardId}`);
        const badge = document.getElementById(`seo-badge-${cardId}`);
        const progressFill = document.getElementById(`seo-progress-${cardId}`);
        const suggestionsContainer = document.getElementById(`seo-suggestions-${cardId}`);

        const seoLock = document.getElementById(`seo-lock-${cardId}`);

        if (!meterContainer || !badge || !progressFill) return;

        const score = (typeof seoData === 'object' && seoData !== null) ? seoData.score : (parseInt(seoData) || 0);

        // Check Plan and Apply Blur
        const currentPlan = window.userUsageData?.plan || 'free';
        if (currentPlan === 'free') {
            meterContainer.classList.add('pro-feature-locked');
            if (seoLock) seoLock.style.display = 'flex';
        } else {
            meterContainer.classList.remove('pro-feature-locked');
            if (seoLock) seoLock.style.display = 'none';
        }

        // Determine grade and emoji
        let grade = '';
        let gradeClass = '';
        let emoji = '';

        if (score >= 80) {
            grade = 'Excellent';
            gradeClass = 'excellent';
            emoji = '🟢';
        } else if (score >= 60) {
            grade = 'Good';
            gradeClass = 'good';
            emoji = '🔵';
        } else if (score >= 40) {
            grade = 'Average';
            gradeClass = 'average';
            emoji = '🟡';
        } else {
            grade = 'Poor';
            gradeClass = 'poor';
            emoji = '🔴';
        }

        // Update badge
        badge.textContent = `${score} / 100 ${emoji} ${grade}`;
        badge.className = `seo-badge ${gradeClass}`;

        // Update progress bar
        progressFill.style.width = `${score}%`;
        progressFill.className = `seo-progress-fill ${gradeClass}`;

        // Display suggestions with Fix buttons
        if (suggestionsContainer) {
            if (score < 100 && seoData && seoData.suggestions && seoData.suggestions.length > 0) {
                suggestionsContainer.innerHTML = seoData.suggestions.map(s => {
                    const fixBtn = s.fixType
                        ? ` <button onclick="window.fixSeoIssue('${cardId}','${s.fixType}')" style="margin-left:6px; padding:1px 8px; font-size:0.85em; border:1px solid #10B981; background:rgba(16,185,129,0.15); color:#10B981; border-radius:4px; cursor:pointer; font-weight:700; white-space:nowrap;" onmouseover="this.style.background='#10B981';this.style.color='#fff'" onmouseout="this.style.background='rgba(16,185,129,0.15)';this.style.color='#10B981'">⚡ Fix</button>`
                        : '';
                    return `<div style="margin-bottom: 3px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap;"><span style="flex:1;">${s.text}</span>${fixBtn}</div>`;
                }).join('');
                suggestionsContainer.style.display = 'flex';
            } else {
                suggestionsContainer.innerHTML = score >= 100 ? '<div style="color:#10B981; font-weight:700;">✅ Perfect SEO! No improvements needed.</div>' : '';
                suggestionsContainer.style.display = score >= 100 ? 'flex' : 'none';
            }
        }

        // Show the meter
        meterContainer.style.display = 'block';
    }

    function reorderKeywords(keywordsStr) {
        if (!keywordsStr) return "";
        const keywords = keywordsStr.split(',').map(k => k.trim()).filter(Boolean);
        const uniqueKeywords = [...new Set(keywords)]; // Remove exact duplicates

        const singles = [];
        const doubles = [];
        const multis = [];

        uniqueKeywords.forEach(k => {
            const wordCount = k.split(/\s+/).length;
            if (wordCount === 1) singles.push(k);
            else if (wordCount === 2) doubles.push(k);
            else multis.push(k);
        });

        // Strategy: Top 10 Single, Top 10 Double, Top 10 Multi, then leftovers
        const sorted = [];

        // 1. First 10 High Weight (Single)
        sorted.push(...singles.slice(0, 10));

        // 2. Next 10 Medium Weight (Double)
        sorted.push(...doubles.slice(0, 10));

        // 3. Next 10 Low Weight (Multi)
        sorted.push(...multis.slice(0, 10));

        // 4. Leftovers (prioritizing Single -> Double -> Multi)
        sorted.push(...singles.slice(10));
        sorted.push(...doubles.slice(10));
        sorted.push(...multis.slice(10));

        return sorted.join(', ');
    }

    window.copyToClipboard = function (button, type) {
        const card = button.closest('.file-preview-card');
        let text = '';

        if (type === 'title') {
            text = card.querySelector('.meta-title').textContent;
        } else if (type === 'description') {
            text = card.querySelector('.meta-description').textContent;
        } else if (type === 'style') {
            text = card.querySelector('.meta-style-container').textContent.trim();
        } else if (type === 'mood') {
            text = card.querySelector('.meta-mood-container').textContent.trim();
        } else if (type === 'keywords') {
            text = Array.from(card.querySelectorAll('.meta-keyword-pill')).map(pill => {
                const clone = pill.cloneNode(true);
                const badge = clone.querySelector('.demand-badge');
                if (badge) badge.remove();
                return clone.textContent.trim();
            }).join(', ');
        }

        if (text) navigator.clipboard.writeText(text).then(() => {
            const originalText = button.innerHTML;
            button.innerHTML = '<i class="icon-check"></i>Copied!';
            setTimeout(() => { button.innerHTML = originalText; }, 1500);
        });
    };
    window.regenerateMetadata = async function (button) {
        const card = button.closest('.file-preview-card');
        const fileData = uploadedFilesData.find(f => f.id === card.id);
        if (!fileData) return;
        fileData.title = ''; fileData.keywords = ''; fileData.description = '';
        button.disabled = true; button.innerHTML = '<span class="icon-spinner"></span>';
        try {
            const metadata = await generateMetadata(fileData);
            fileData.title = metadata.title;
            fileData.keywords = metadata.keywords;
            fileData.description = metadata.description || '';
        } catch (error) {
            console.error("Error regenerating metadata:", error);
            fileData.title = "Error";
        } finally {
            button.disabled = false;
            button.innerHTML = '<span style="font-size:1.1em;">&#x21bb;</span>';
            updateAllButtonStates();
        }
    };

    window.closeCard = function (button) {
        const card = button.closest('.file-preview-card');
        if (card) {
            const idx = uploadedFilesData.findIndex(f => f.id === card.id);
            if (idx !== -1) uploadedFilesData.splice(idx, 1);
            card.remove();
            updateAllButtonStates();
        }
    };

    const modeButtons = document.querySelectorAll('.mode-button');
    const metaSection = document.querySelector('.file-upload-section');
    const processingArea = document.querySelector('.file-processing-area');
    const dalleSection = document.querySelector('.dalle-image-gen-section');
    const toolWrapper = document.getElementById('toolSectionWrapper');
    const uploadSection = document.getElementById('tour-upload-section');
    const tourPlatformSection = document.getElementById('tour-platform-section');

    // Dedicated Admin Button Handler
    const adminSidebarBtn = document.getElementById('adminSidebarBtn');
    if (adminSidebarBtn) {
        adminSidebarBtn.addEventListener('click', function (e) {
            e.preventDefault();
            // Hide upload section explicitly
            if (uploadSection) uploadSection.style.display = 'none';
            if (tourPlatformSection) tourPlatformSection.style.display = 'none';
        });
    }

    document.body.classList.add('mode-metadata');

    modeButtons.forEach(btn => {
        btn.onclick = function () {
            const section = this.getAttribute('data-section');

            if (section === 'healing') {
                const currentPlan = window.userUsageData?.plan || 'free';
                if (currentPlan.toLowerCase() !== 'pro' && currentPlan.toLowerCase() !== 'premium' && currentPlan.toLowerCase() !== 'agency') {
                    alert("Upgrade to PRO/PREMIUM plan. healing features are for pro & premium users only.");
                    if (typeof scrollToPricing === 'function') scrollToPricing();
                    return;
                }
            }

            if (section === 'sales-prediction') {
                const currentPlan = window.userUsageData?.plan || 'free';
                if (currentPlan.toLowerCase() !== 'pro' && currentPlan.toLowerCase() !== 'premium' && currentPlan.toLowerCase() !== 'agency') {
                    alert("Upgrade to PRO/PREMIUM plan. sales-prediction features are for pro & premium users only.");
                    if (typeof scrollToPricing === 'function') scrollToPricing();
                    return;
                }
            }

            if (section === 'bg-remove') {
                const currentPlan = window.userUsageData?.plan || 'free';
                if (currentPlan.toLowerCase() !== 'pro' && currentPlan.toLowerCase() !== 'premium' && currentPlan.toLowerCase() !== 'agency') {
                    alert("Upgrade to PRO/PREMIUM plan. Remove Background feature is for pro & premium users only.");
                    if (typeof scrollToPricing === 'function') scrollToPricing();
                    return;
                }
            }

            modeButtons.forEach(b => b.classList.remove('active'));
            this.classList.add('active');

            document.body.classList.remove('mode-metadata', 'mode-image-prompt', 'mode-dalle', 'mode-niche', 'mode-calendar', 'mode-admin', 'mode-healing', 'mode-sales-prediction');

            // Hide all sections first
            if (metaSection) metaSection.style.display = 'none';
            if (processingArea) processingArea.style.display = 'none';
            if (dalleSection) dalleSection.style.display = 'none';
            if (uploadSection) uploadSection.style.display = 'none';
            if (tourPlatformSection) tourPlatformSection.style.display = 'none';

            const calendarSection = document.getElementById('stockCalendarSection');
            const nicheSection = document.getElementById('nicheResearchSection');
            const adminSection = document.getElementById('adminDashboardSection');
            const healingSection = document.getElementById('imageHealingSection');
            const salesPredSection = document.getElementById('salesPredictionSection');
            const bgRemovalSection = document.getElementById('bgRemovalSection');

            if (calendarSection) calendarSection.style.display = 'none';
            if (nicheSection) nicheSection.style.display = 'none';
            if (adminSection) adminSection.style.display = 'none';
            if (healingSection) healingSection.style.display = 'none';
            if (salesPredSection) salesPredSection.style.display = 'none';
            if (bgRemovalSection) bgRemovalSection.style.display = 'none';

            if (section === 'meta') {
                document.body.classList.add('mode-metadata');
                if (metaSection) metaSection.style.display = 'flex';
                if (processingArea) processingArea.style.display = 'flex';
            } else if (section === 'prompt') {
                document.body.classList.add('mode-image-prompt');
                if (metaSection) metaSection.style.display = 'flex';
                if (processingArea) processingArea.style.display = 'flex';
            } else if (section === 'dalle') {
                document.body.classList.add('mode-dalle');
                if (dalleSection) dalleSection.style.display = 'block';
            } else if (section === 'niche') {
                document.body.classList.add('mode-niche');
                if (nicheSection) nicheSection.style.display = 'block';
                if (calendarSection) {
                    calendarSection.style.display = 'block';
                    if (typeof initStockCalendar === 'function') initStockCalendar();
                }

                // NEW: Trigger Live Trend Forecaster on Tab Open
                if (typeof loadRealTimeTrends === 'function') {
                    loadRealTimeTrends();
                }
            } else if (section === 'healing') {
                document.body.classList.add('mode-healing');
                if (healingSection) healingSection.style.display = 'block';
            } else if (section === 'sales-prediction') {
                document.body.classList.add('mode-sales-prediction');
                if (salesPredSection) salesPredSection.style.display = 'block';
            } else if (section === 'admin') {
                document.body.classList.add('mode-admin');
                if (toolWrapper) {
                    toolWrapper.style.display = 'block';
                    toolWrapper.classList.add('active');
                }
                if (adminSection) {
                    adminSection.style.display = 'block';
                    loadAdminDashboardData();
                }
                // Ensure upload sections are hidden for admin mode
                if (uploadSection) uploadSection.style.display = 'none';
                if (tourPlatformSection) tourPlatformSection.style.display = 'none';
            }

            if (section === 'meta' || section === 'prompt') {
                if (tourPlatformSection) tourPlatformSection.style.display = 'flex';
                if (uploadSection) uploadSection.style.display = 'flex';
            }

            // Manage hero section visibility
            if (section !== 'meta' && section !== 'prompt' && section !== 'dalle' && section !== 'niche' && section !== 'calendar' && section !== 'admin') {
                // Probably landing page
            } else {
                const heroSection = document.getElementById('heroLandingSection');
                if (heroSection) heroSection.style.display = 'none';
            }

            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });

            if (window.innerWidth <= 700) {
                const sidebar = document.getElementById('appSidebar');
                const body = document.body;
                if (sidebar) sidebar.classList.remove('visible');
                body.classList.remove('sidebar-hidden');
            }
        };
    });


    async function generatePromptForImage(imageFile) {
        const selectedProvider = document.getElementById('aiProviderSelect')?.value || 'groq';

        const base64Image = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = error => reject(error);
            reader.readAsDataURL(imageFile);
        });

        // --- 📊 Credit Check ---
        if (window.userUsageData && window.userUsageData.count >= window.userUsageData.limit) {
            showLimitModal();
            return;
        }

        const user = auth.currentUser;

        let isPaidPlan = false;
        let dbPlan = "";
        if (user) {
            try {
                const profileDoc = await db.collection('users').doc(user.email.toLowerCase()).get();
                const profileData = profileDoc.exists ? profileDoc.data() : null;
                dbPlan = (profileData?.plan || '').toLowerCase();
                isPaidPlan = (dbPlan === 'pro' || dbPlan === 'premium' || dbPlan === 'agency');
            } catch (e) { console.warn('Plan check failed:', e); }
        }

        let apiKey = null;
        const promptInstruction = `Analyze the provided image as a forensic graphic designer. Reverse-engineer it into three different highly detailed text-to-image prompts (optimized for Midjourney v6 / DALL-E 3).

CRITICAL INSTRUCTIONS FOR ALL PROMPTS:
- Text & Typography: Read the exact text. If letters have custom stylization (e.g., an 'E' made only of three horizontal bars without a vertical stem, or specific letters in different colors), describe that exact custom typography in detail.
- Geometry & Strokes: Differentiate between solid filled shapes and outlined shapes with negative space. Note if lines are disconnected, curved, sharp, or tapered.
- Layout: Describe the exact placement of the icon relative to the text.

The three styles MUST be:
1. realistic: A highly detailed, EXACT descriptive replica of the uploaded image. If the image is a flat vector logo, describe it EXACTLY as a flat vector logo on a solid clean background with crisp, sharp edges. Describe the exact geometric shapes (e.g., 'upper wings formed by two disconnected curved orange strokes leaving negative space inside', 'lower wing is a black outline resembling a leaf with a small inner stroke'). Describe the exact text and its unique font modifications. Do NOT add 3D, mockup, or realistic photo elements.
2. illustration: Transform the image into an artistic digital illustration while maintaining the exact original subject, text, and composition. Describe it using terms like digital painting, cel-shaded, or stylized vector art.
3. 3d: Transform the image into a modern 3D render. Maintain the exact original subject and text, but add 3D elements like Unreal Engine 5, ray tracing, soft studio lighting, and 3D textures (e.g., matte plastic, glossy acrylic).

Provide ONLY the raw JSON object, exactly like this format. Do not use markdown blocks (\`\`\`json):
{
  "realistic": "[your forensic, extremely detailed descriptive prompt here]",
  "illustration": "[your vivid illustration prompt here]",
  "3d": "[your 3D render prompt here]"
}`;

        // ================= server-side PROXY LOGIC =================
        let proxyUrl = "";
        if (dbPlan === 'pro') {
            proxyUrl = "https://metagen-pro-api.metagenp.workers.dev/generate";
        } else if (dbPlan === 'premium') {
            proxyUrl = "https://metagen-pro-api.metagenp.workers.dev/generate";
        } else {
            proxyUrl = "https://metagen-pro-api.metagenp.workers.dev/generate";
        }

        try {
            const response = await fetch(proxyUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${user ? await user.getIdToken() : ""}`
                },
                body: JSON.stringify({
                    action: "generatePrompt",
                    base64Image: base64Image,
                    image: base64Image,
                    mimeType: imageFile.type,
                    prompt: promptInstruction,
                    provider: selectedProvider,
                    email: user?.email || "unknown",
                    deviceInfo: navigator.userAgent,
                    plan: "pro" // Tell edge function this is a paid user - bypass trial limits
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(`Proxy API Error: ${data.error || response.statusText}`);
            }

            let generatedText = "";
            if (data.metadata) {
                generatedText = typeof data.metadata === 'string' ? data.metadata : JSON.stringify(data.metadata);
            } else if (selectedProvider === 'gemini' && data.candidates) {
                generatedText = data.candidates[0].content.parts[0].text;
            } else if (data.choices) {
                generatedText = data.choices[0].message.content;
            } else if (data.text) {
                generatedText = data.text;
            } else {
                generatedText = JSON.stringify(data);
            }

            // Strip typical markdown wrapper from proxy if present
            const finalPrompt = generatedText.replace(/^```[a-z]*\s*|\s*```$/gi, '').trim();

            return finalPrompt;

        } catch (error) {
            console.error("Proxy Prompt Gen Error:", error);
            throw error;
        }
    }
    window.switchPromptStyle = function (cardId, style) {
        const card = document.getElementById(cardId);
        if (!card) return;

        // Deactivate all tabs
        const tabs = card.querySelectorAll('.prompt-tab-btn');
        tabs.forEach(tab => {
            if (tab.dataset.style === style) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });

        // Hide all style contents
        const contents = card.querySelectorAll('.prompt-style-content');
        contents.forEach(content => {
            if (content.id === `prompt-${style}-${cardId}`) {
                content.style.display = 'block';
                content.classList.add('active');
            } else {
                content.style.display = 'none';
                content.classList.remove('active');
            }
        });
    };

    window.copyPromptFromCard = function (button) {
        const container = button.closest('.prompt-result-container');
        const activeContent = container.querySelector('.prompt-style-content.active') || container.querySelector('.prompt-text');
        const text = activeContent ? activeContent.textContent : '';

        navigator.clipboard.writeText(text).then(() => {
            const originalText = button.innerHTML;
            button.innerHTML = '<i class="icon-check"></i> Copied!';
            setTimeout(() => { button.innerHTML = originalText; }, 1500);
        });
    };

    window.copyAllPromptsFromCard = function (cardId) {
        const card = document.getElementById(cardId);
        if (!card) return;

        const realistic = card.querySelector(`#prompt-realistic-${cardId}`)?.textContent || '';
        const illustration = card.querySelector(`#prompt-illustration-${cardId}`)?.textContent || '';
        const cgi3d = card.querySelector(`#prompt-3d-${cardId}`)?.textContent || '';

        const combinedText = `--- REALISTIC STYLE ---\n${realistic}\n\n--- ILLUSTRATION STYLE ---\n${illustration}\n\n--- 3D RENDER STYLE ---\n${cgi3d}`;

        navigator.clipboard.writeText(combinedText).then(() => {
            const button = card.querySelector('.action-button.purple-button');
            if (button) {
                const originalText = button.innerHTML;
                button.innerHTML = '<i class="icon-check"></i> Copied All!';
                setTimeout(() => { button.innerHTML = originalText; }, 1500);
            }
        });
    };

    window.downloadPromptFromCard = function (button) {
        const container = button.closest('.prompt-result-container');
        const activeContent = container.querySelector('.prompt-style-content.active') || container.querySelector('.prompt-text');
        const text = activeContent ? activeContent.textContent : '';

        const card = button.closest('.file-preview-card');
        const filename = card.querySelector('.card-filename').textContent.replace(/\.[^/.]+$/, "") + '_prompt.txt';
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };



    const generateDalleBtn = document.getElementById('generateDalleBtn');
    const dallePrompt = document.getElementById('dallePrompt');
    const dalleModel = document.getElementById('dalleModel');
    const dalleSteps = document.getElementById('dalleSteps');
    const dalleVariation = document.getElementById('dalleVariation');
    const dalleLoading = document.getElementById('dalleLoading');
    const dalleImagePreview = document.getElementById('dalleImagePreview');
    const dalleError = document.getElementById('dalleError');

    async function generateDalleImage(prompt, model, steps, n) {
        const apiKey = localStorage.getItem('togetherApiKey');
        if (!apiKey) throw new Error('Hugging Face API Key not set.');

        const response = await fetch('https://api.together.xyz/inference', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model,
                prompt: prompt,
                n: n,
                steps: steps
            })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error?.message || 'Failed to generate image');
        }
        if (!data.output || !Array.isArray(data.output.choices)) throw new Error('No image generated.');
        return data.output.choices.map(choice => `data:image/png;base64,${choice.image_base64}`);
    }

    if (generateDalleBtn) {
        generateDalleBtn.onclick = async function (event) {
            event.preventDefault();
            dalleImagePreview.innerHTML = '';
            dalleError.style.display = 'none';
            dalleLoading.style.display = 'block';
            generateDalleBtn.disabled = true;
            try {
                const prompt = dallePrompt.value.trim();
                const model = dalleModel.value;
                const steps = parseInt(dalleSteps.value) || 16;
                const n = parseInt(dalleVariation.value) || 1;
                if (!prompt) throw new Error('Please enter a prompt.');

                await new Promise(res => setTimeout(res, 1500));
                const urls = Array(n).fill(`https://placehold.co/220x220/1E293B/fff?text=AI+Image`);

                dalleImagePreview.innerHTML = urls.map((url, idx) => `
                <div class="dalle-image-card">
                    <img src="${url}" alt="Generated Image ${idx + 1}" class="dalle-image" />
                    <div class="dalle-image-actions">
                        <button class="action-button green-button" style="margin-top:10px;" onclick="addDalleImageToGrid('${url.replace(/'/g, '\\\'')}', 'AI Generated Image')">Add to Grid</button>
                        <a href="${url}" download="generated-image-${idx + 1}.png" class="action-button blue-button" style="margin-top:10px;margin-left:8px;">Download</a>
                    </div>
                </div>
            `).join('');

            } catch (err) {
                dalleError.textContent = err.message;
                dalleError.style.display = 'block';
            } finally {
                dalleLoading.style.display = 'none';
                generateDalleBtn.disabled = false;
            }
        };
    }
    window.addDalleImageToGrid = function (url, filename) {
        fetch(url)
            .then(res => res.blob())
            .then(blob => {
                const file = new File([blob], filename + '.png', { type: blob.type });
                file.isAiGenerated = true;
                handleFiles([file]);
            });
    };
    const closeDalleSectionBtn = document.getElementById('closeDalleSectionBtn');
    if (closeDalleSectionBtn) {
        closeDalleSectionBtn.onclick = function () {
            document.querySelector('[data-section="meta"]').click();
        };
    }

    const style = document.createElement('style');
    style.textContent = `
    .icon-copy:before { content: "📋"; }
    .icon-check:before { content: "✓"; }
    .icon-download:before { content: "⬇"; }
    .icon-embed:before { content: "📥"; }
    .icon-error:before { content: "✕"; }
    .icon-process:before { content: "⚙️"; }
    .icon-export-csv:before { content: "📄"; }
    .icon-info:before { content: "ℹ️"; }
    .icon-clear:before { content: "🗑️"; }
    .icon-api-key:before { content: "🔑"; }
    .icon-metadata:before { content: "📝"; margin-right: 5px; }
    .icon-image-to-prompt:before { content: "🖼️"; margin-right: 5px; }
    .icon-dalle:before { content: "✨"; margin-right: 5px; }
    .icon-dropdown-arrow:before { content: "▼"; display: inline-block; transition: transform 0.3s; margin-left: 10px; margin-top: 8px; }
    .collapsible-header.open .icon-dropdown-arrow:before { transform: rotate(180deg); }
    .icon-spinner:before { content: "𖤓"; animation: spin 1s linear infinite; display: inline-block; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

    /* Export Dropdown Styles */
    .export-dropdown {
        position: relative;
        display: inline-block;
    }

    .export-dropdown-content {
        display: none;
        position: absolute;
        right: 0;
        background-color: var(--bg-tertiary);
        min-width: 160px;
        box-shadow: 0 8px 16px 0 rgba(0,0,0,0.2);
        z-index: 1;
        border-radius: 8px;
        border: 1px solid var(--border-color);
        overflow: hidden;
    }

    .export-dropdown-content a {
        color: var(--text-primary);
        padding: 12px 16px;
        text-decoration: none;
        display: block;
        font-size: 0.9em;
        transition: background-color 0.2s;
    }

    .export-dropdown-content a:hover {
        background-color: var(--bg-input);
        color: var(--accent-orange);
    }

    .export-dropdown.show .export-dropdown-content {
        display: block;
    }

    .login-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        display: flex;
        z-index: 9999;
        overflow: hidden;
    }

    .login-modal.hidden {
        display: none;
    }

    .login-split-layout {
        display: flex;
        width: 100%;
        height: 100%;
    }

    /* Left Pane */
    .login-left-pane {
        position: relative;
        width: 50%;
        background: linear-gradient(135deg, #7B2FF2 0%, #9B59B6 25%, #2196F3 50%, #00BCD4 75%, #7B2FF2 100%);
        background-size: 400% 400%;
        animation: loginGradientShift 12s ease infinite;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        padding: 40px;
    }

    @keyframes loginGradientShift {
        0% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
    }

    /* Floating Bubbles */
    .login-bubble {
        position: absolute;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.07);
        border: 1px solid rgba(255, 255, 255, 0.15);
        backdrop-filter: blur(4px);
    }

    .login-bubble-1 {
        width: 200px; height: 200px;
        top: -40px; left: -40px;
        animation: loginBubbleFloat1 8s ease-in-out infinite;
    }
    .login-bubble-2 {
        width: 120px; height: 120px;
        top: 30%; right: -20px;
        background: rgba(255, 255, 255, 0.1);
        animation: loginBubbleFloat2 10s ease-in-out infinite;
    }
    .login-bubble-3 {
        width: 80px; height: 80px;
        bottom: 20%; left: 15%;
        background: rgba(255, 255, 255, 0.12);
        animation: loginBubbleFloat3 7s ease-in-out infinite;
    }
    .login-bubble-4 {
        width: 300px; height: 300px;
        bottom: -80px; right: -60px;
        background: rgba(255, 255, 255, 0.05);
        animation: loginBubbleFloat4 14s ease-in-out infinite;
    }
    .login-bubble-5 {
        width: 50px; height: 50px;
        top: 55%; left: 50%;
        background: rgba(255, 255, 255, 0.15);
        animation: loginBubbleFloat5 6s ease-in-out infinite;
    }
    .login-bubble-6 {
        width: 160px; height: 160px;
        top: 10%; left: 60%;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.1);
        animation: loginBubbleFloat6 11s ease-in-out infinite;
    }

    @keyframes loginBubbleFloat1 {
        0%, 100% { transform: translate(0, 0) scale(1); }
        50% { transform: translate(30px, 40px) scale(1.1); }
    }
    @keyframes loginBubbleFloat2 {
        0%, 100% { transform: translate(0, 0) scale(1); }
        50% { transform: translate(-25px, 30px) scale(0.9); }
    }
    @keyframes loginBubbleFloat3 {
        0%, 100% { transform: translate(0, 0); }
        50% { transform: translate(20px, -25px); }
    }
    @keyframes loginBubbleFloat4 {
        0%, 100% { transform: translate(0, 0) scale(1); }
        50% { transform: translate(-40px, -30px) scale(1.05); }
    }
    @keyframes loginBubbleFloat5 {
        0%, 100% { transform: translate(0, 0); }
        50% { transform: translate(-15px, 20px); }
    }
    @keyframes loginBubbleFloat6 {
        0%, 100% { transform: translate(0, 0) scale(1); }
        50% { transform: translate(20px, -35px) scale(1.08); }
    }

    /* Left pane content */
    .login-left-content {
        position: relative;
        z-index: 2;
        color: #fff;
        max-width: 420px;
        animation: loginSlideInLeft 0.6s ease-out;
    }

    @keyframes loginSlideInLeft {
        from { opacity: 0; transform: translateX(-30px); }
        to { opacity: 1; transform: translateX(0); }
    }

    .login-left-logo {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 30px;
    }

    .login-logo-icon {
        font-size: 1.6em;
        filter: drop-shadow(0 0 6px rgba(255,255,255,0.4));
    }

    .login-logo-text {
        font-size: 1.2em;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }

    .login-left-title {
        font-size: 2.5em;
        font-weight: 800;
        line-height: 1.1;
        margin: 0 0 12px 0;
        text-shadow: 0 4px 20px rgba(0,0,0,0.15);
        color: #fff;
    }

    .login-left-subtitle {
        font-size: 1.1em;
        opacity: 0.85;
        margin: 0 0 35px 0;
        letter-spacing: 0.03em;
        color: aquamarine;
    }

    .login-features-list {
        display: flex;
        flex-direction: column;
        gap: 18px;
        margin-bottom: 40px;
    }

    .login-feature-item {
        display: flex;
        align-items: flex-start;
        gap: 14px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        padding: 14px 16px;
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255, 255, 255, 0.12);
        transition: transform 0.2s ease, background 0.2s ease;
    }

    .login-feature-item:hover {
        transform: translateX(6px);
        background: rgba(255, 255, 255, 0.16);
    }

    .login-feature-icon {
        font-size: 1.5em;
        flex-shrink: 0;
        margin-top: 2px;
    }

    .login-feature-item strong {
        font-size: 0.95em;
        display: block;
        margin-bottom: 3px;
    }

    .login-feature-item p {
        font-size: 0.82em;
        margin: 0;
        opacity: 0.8;
        line-height: 1.4;
    }

    .login-left-footer {
        font-size: 0.85em;
        opacity: 0.6;
        letter-spacing: 0.12em;
        text-transform: uppercase;
    }

    /* Right Pane */
    .login-right-pane {
        width: 50%;
        background: #ffffff;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        padding: 40px;
        overflow-y: auto;
    }

    .login-close-btn {
        position: absolute;
        top: 18px;
        right: 22px;
        background: none;
        border: none;
        font-size: 1.8em;
        color: #999;
        cursor: pointer;
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: all 0.2s;
        z-index: 10;
    }

    .login-close-btn:hover {
        background: #f0f0f0;
        color: #333;
    }

    .login-container {
        max-width: 380px;
        width: 100%;
        animation: loginSlideInRight 0.6s ease-out;
    }

    @keyframes loginSlideInRight {
        from { opacity: 0; transform: translateX(30px); }
        to { opacity: 1; transform: translateX(0); }
    }

    .login-header {
        margin-bottom: 8px;
    }

    .login-greeting {
        font-size: 1.6em;
        font-weight: 700;
        color: #1a1a2e;
        margin: 0 0 2px 0;
    }

    .login-time-greeting {
        font-size: 1.1em;
        color: #7B2FF2;
        font-weight: 500;
        margin: 0 0 20px 0;
    }

    .login-form-title {
        font-size: 1.05em;
        color: #333;
        margin: 0 0 25px 0;
        font-weight: 500;
    }

    .login-form-group {
        margin-bottom: 20px;
    }

    .login-form-group label {
        display: block;
        color: #666;
        font-weight: 500;
        margin-bottom: 6px;
        font-size: 0.88em;
        letter-spacing: 0.02em;
    }

    .login-form-group input {
        width: 100%;
        padding: 10px 2px;
        background: transparent;
        border: none;
        border-bottom: 2px solid #e0e0e0;
        color: #1a1a2e;
        font-size: 0.95em;
        box-sizing: border-box;
        transition: border-color 0.3s ease;
        outline: none;
        border-radius: 0;
    }

    .login-form-group input:focus {
        border-bottom-color: #7B2FF2;
    }

    .login-form-group input::placeholder {
        color: #bbb;
    }

    .login-options-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 22px;
        font-size: 0.82em;
    }

    .login-remember {
        display: flex;
        align-items: center;
        gap: 6px;
        color: #666;
        cursor: pointer;
    }

    .login-remember input[type="checkbox"] {
        width: 15px;
        height: 15px;
        accent-color: #7B2FF2;
        cursor: pointer;
    }

    .login-forgot {
        color: #7B2FF2;
        text-decoration: none;
        font-weight: 500;
        transition: color 0.2s;
    }

    .login-forgot:hover {
        color: #5a1fbf;
        text-decoration: underline;
    }

    .login-button {
        width: 100%;
        padding: 13px 16px;
        border: none;
        border-radius: 6px;
        font-weight: 700;
        font-size: 0.95em;
        cursor: pointer;
        transition: all 0.3s ease;
        text-align: center;
        letter-spacing: 0.08em;
    }

    .login-button.primary {
        background: linear-gradient(135deg, #7B2FF2 0%, #2196F3 100%);
        color: white;
        box-shadow: 0 4px 15px rgba(123, 47, 242, 0.3);
    }

    .login-button.primary:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 22px rgba(123, 47, 242, 0.45);
    }

    .login-button.primary:active {
        transform: translateY(0);
    }

    .login-button.google-button {
        background: #fff;
        color: #333;
        border: 1.5px solid #e0e0e0;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        font-weight: 600;
        letter-spacing: 0.02em;
    }

    .login-button.google-button:hover {
        background: #f7f7f7;
        transform: translateY(-1px);
        box-shadow: 0 3px 10px rgba(0, 0, 0, 0.08);
    }

    .login-divider {
        display: flex;
        align-items: center;
        margin: 22px 0;
        gap: 12px;
    }

    .login-divider-line {
        flex: 1;
        height: 1px;
        background: #e0e0e0;
    }

    .login-divider span {
        color: #aaa;
        font-size: 0.8em;
        font-weight: 500;
        letter-spacing: 0.05em;
    }

    .login-toggle {
        text-align: center;
        margin-top: 20px;
        color: #888;
        font-size: 0.9em;
    }

    .login-toggle a {
        color: #7B2FF2;
        cursor: pointer;
        text-decoration: none;
        font-weight: 600;
    }

    .login-toggle a:hover {
        text-decoration: underline;
    }

    .login-error {
        background: #fef2f2;
        border: 1px solid #fca5a5;
        color: #b91c1c;
        padding: 12px;
        border-radius: 8px;
        margin-bottom: 18px;
        font-size: 0.88em;
        display: none;
    }

    .login-error.show {
        display: block;
    }

    .login-success {
        background: #f0fdf4;
        border: 1px solid #86efac;
        color: #166534;
        padding: 12px;
        border-radius: 8px;
        margin-bottom: 18px;
        font-size: 0.88em;
        display: none;
    }

    .login-success.show {
        display: block;
    }

    /* Responsive: Stack on mobile */
    @media (max-width: 768px) {
        .login-split-layout {
            flex-direction: column;
        }
        .login-left-pane {
            width: 100%;
            min-height: 220px;
            padding: 30px 24px;
        }
        .login-left-title {
            font-size: 2em;
        }
        .login-features-list {
            display: none;
        }
        .login-right-pane {
            width: 100%;
            flex: 1;
            padding: 30px 24px;
        }
    }

    .user-profile {
        position: fixed;
        top: 70px;
        right: 20px;
        display: none;
        align-items: center;
        gap: 15px;
        z-index: 1000;
    }

    .user-profile.visible {
        display: flex;
    }

    .user-email {
        color: #E2E8F0;
        font-size: 0.9em;
        background: #1E293B;
        padding: 8px 12px;
        border-radius: 6px;
        border: 1px solid #334155;
    }

    .logout-btn {
        background: #EF4444;
        color: white;
        border: none;
        padding: 8px 14px;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 600;
        font-size: 0.85em;
        transition: background 0.2s;
        display: none; /* Hidden - removed from header */
    }

    .logout-btn:hover {
        background: #DC2626;
    }

        /* Profile Header Button */
        .profile-header-btn {
            background: none;
            border: 1.5px solid #334155;
            color: #F8FAFC;
            border-radius: 8px;
            cursor: pointer;
            padding: 4px 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
            width: 38px;
            height: 34px;
        }

        .profile-avatar-small {
            width: 24px;
            height: 24px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, #7C7CED 0%, #5B5BED 100%);
            color: white;
            font-weight: 600;
            font-size: 0.9em;
            overflow: hidden;
        }

        .profile-header-btn:hover {
            background-color: #334155;
            border-color: #F97316;
            color: #F97316;
            transform: scale(1.05);
        }

        /* Profile Modal Styles */
        .profile-modal {
            position: fixed;
            top: 65px;
            right: 20px;
            background: var(--bg-modal);
            border-radius: 12px;
            box-shadow: 0 8px 32px var(--shadow-md);
            border: 1.5px solid var(--border-color);
            width: 350px;
            max-width: 90vw;
            z-index: 2000;
            display: flex;
            flex-direction: column;
            animation: slideDown 0.3s ease-out;
        }

        .profile-modal.hidden {
            display: none;
        }

        @keyframes slideDown {
            from {
                opacity: 0;
                transform: translateY(-10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .profile-modal-backdrop {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 1999;
        }

        .profile-modal-backdrop.hidden {
            display: none;
        }

    .profile-modal-close {
        position: absolute;
        top: 12px;
        right: 12px;
        background: none;
        border: none;
        color: #94A3B8;
        font-size: 1.6em;
        cursor: pointer;
        transition: color 0.2s ease;
        padding: 0;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1;
    }

    .profile-modal-close:hover {
        color: #F97316;
    }

    .profile-modal-body {
        padding: 28px 20px 20px 20px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        position: relative;
        overflow-y: auto;
        height: 580px;
    }

    .profile-avatar-section {
        margin-bottom: 4px;
    }

    .profile-avatar {
        width: 96px;
        height: 96px;
        background: linear-gradient(135deg, #7C7CED 0%, #5B5BED 100%);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        box-shadow: 0 4px 16px rgba(123, 124, 237, 0.4);
        position: relative;
        overflow: hidden;
    }

    .profile-avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .profile-avatar svg {
        color: white;
    }

    .profile-user-info {
        text-align: center;
        width: 100%;
    }

    .profile-user-info h2 {
        color: var(--text-primary);
        margin: 0 0 4px 0;
        font-size: 1.1em;
        font-weight: 600;
    }

    .profile-user-info p {
        color: var(--text-secondary);
        margin: 0;
        font-size: 0.85em;
    }

    .profile-divider {
        width: calc(100% + 40px);
        height: 1px;
        background: var(--border-color);
        margin: 0 -20px;
    }

    .profile-actions {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 0;
    }

    .profile-action-btn {
        width: 100%;
        padding: 12px 16px;
        background: none;
        border: none;
        border-bottom: 1px solid var(--border-color);
        color: var(--text-secondary);
        font-weight: 500;
        font-size: 0.9em;
        cursor: pointer;
        transition: background 0.2s ease;
        display: flex;
        align-items: center;
        gap: 12px;
        text-align: left;
    }

    .profile-action-btn:last-child {
        border-bottom: none;
    }

    .profile-action-btn:hover {
        background: var(--bg-tertiary);
    }

    .profile-action-btn span:first-child {
        font-size: 1.2em;
    }

    .profile-footer {
        width: 100%;
        text-align: center;
        padding-top: 12px;
        color: #64748B;
        font-size: 0.75em;
    }

    .profile-footer a {
        color: #64748B;
        text-decoration: none;
        transition: color 0.2s ease;
    }

    .profile-footer a:hover {
        color: #94A3B8;
    }

    .profile-dot {
        margin: 0 4px;
    }        @media (max-width: 600px) {
            .profile-modal {
                width: calc(100vw - 40px);
                right: 20px;
            }
        }
`;
    document.head.appendChild(style);
    // Keyword Management Functions
    window.updateKeywordsDisplay = function (cardId) {
        const card = document.getElementById(cardId);
        if (!card) return;

        const fileData = uploadedFilesData.find(f => f.id === cardId);
        if (!fileData || !fileData.keywords) return;

        const keywordsContainer = card.querySelector('.meta-keywords');
        if (!keywordsContainer) return;

        const keywords = Array.isArray(fileData.keywords) ? fileData.keywords.filter(k => k && k.trim()) : fileData.keywords.split(',').filter(k => k.trim());

        keywordsContainer.innerHTML = keywords.map((k, index) => {
            const kw = k.trim();
            if (!kw) return '';
            const wordCount = kw.split(/\s+/).length;

            // Determine badge color (Word Count)
            let badgeHtml = wordCount === 1 ? `<span class="demand-badge demand-risky">🟢</span>` :
                (wordCount === 2 ? `<span class="demand-badge demand-med">🟡</span>` :
                    `<span class="demand-badge demand-high">🔵</span>`);

            // Get Score (New)
            const score = (fileData.keywordScores && fileData.keywordScores[kw.toLowerCase()]) || 0;
            let scoreHtml = '';
            if (score > 0) {
                // Color coding for score
                let scoreColor = '#94A3B8'; // default grey
                if (score >= 80) scoreColor = '#10B981'; // green
                else if (score >= 50) scoreColor = '#FBBF24'; // yellow
                else if (score > 0) scoreColor = '#EF4444'; // red

                scoreHtml = `<span class="keyword-score" style="font-size: 0.85em; margin-left: 5px; font-weight:bold; color: ${scoreColor};" title="Stock Value/Relevance: ${score}">${score}</span>`;
            }

            // 3. Return arranged structure: [Badge] [Keyword] [Score] [Close Button]
            return `<span class="meta-keyword-pill draggable" 
                                  draggable="true"
                                  data-index="${index}"
                                  data-card-id="${cardId}"
                                  ondragstart="handleDragStart(event)"
                                  ondragend="handleDragEnd(event)"
                                  ondragover="handleDragOver(event)"
                                  ondrop="handleDrop(event)"
                                  onclick="handleKeywordClick(event, '${kw.replace(/'/g, "\\'")}', '${cardId}')"
                                  style="display: inline-flex; align-items: center; gap: 2px;">
                                  ${badgeHtml}
                                  <span class="keyword-text">${kw}</span>
                                  ${scoreHtml}
                                  <button class="keyword-remove-btn" 
                                          onclick="event.stopPropagation(); removeKeyword('${cardId}', ${index});" 
                                          onmousedown="event.stopPropagation();"
                                          title="Remove"
                                          style="margin-left: 6px;">×</button>
                             </span>`;
        }).join('');

        // Update Count
        const keywordCountElem = document.getElementById(`keyword-count-${card.id}`);
        if (keywordCountElem) {
            const count = keywords.length;
            keywordCountElem.textContent = `(${count})`;
        }

        // Update SEO Score whenever display updates (implies data change)
        if (typeof calculateSeoScore === 'function' && typeof updateSeoMeter === 'function') {
            const score = calculateSeoScore(fileData);
            updateSeoMeter(cardId, score);
        }
    };

    window.removeKeyword = function (cardId, index) {
        const fileData = uploadedFilesData.find(f => f.id === cardId);
        if (!fileData || !fileData.keywords) return;

        // Robust handling for Array or String
        let keywords = Array.isArray(fileData.keywords)
            ? fileData.keywords
            : fileData.keywords.split(',').map(k => k.trim()).filter(k => k);

        if (index >= 0 && index < keywords.length) {
            keywords.splice(index, 1);
            fileData.keywords = keywords.join(', ');
            updateKeywordsDisplay(cardId);

            // Explicitly update count with visual feedback
            const countElem = document.getElementById(`keyword-count-${cardId}`);
            if (countElem) {
                countElem.textContent = `(${keywords.length})`;
                countElem.style.color = '#EF4444';
                countElem.style.fontWeight = 'bold';
                countElem.style.transition = 'color 0.3s ease';
                setTimeout(() => {
                    countElem.style.color = '';
                    countElem.style.fontWeight = '';
                }, 800);
            }
        }
    };

    window.addKeyword = function (cardId) {
        const input = document.getElementById(`keyword-input-${cardId}`);
        if (!input || !input.value.trim()) return;

        const newKeyword = input.value.trim().toLowerCase(); // Enforce lowercase
        const fileData = uploadedFilesData.find(f => f.id === cardId);
        if (!fileData) return;

        // Robust handling for Array or String
        let keywords = [];
        if (fileData.keywords) {
            keywords = Array.isArray(fileData.keywords)
                ? fileData.keywords
                : fileData.keywords.split(',').map(k => k.trim()).filter(k => k);
        }

        // Avoid duplicates
        if (!keywords.includes(newKeyword)) {
            keywords.push(newKeyword);
            fileData.keywords = keywords.join(', ');

            // Assign default "manual" score (e.g., 100 or a special indicator)
            if (!fileData.keywordScores) fileData.keywordScores = {};
            fileData.keywordScores[newKeyword] = 100; // Assume manually added keywords are high value

            updateKeywordsDisplay(cardId);

            // Explicitly update count with visual feedback
            const countElem = document.getElementById(`keyword-count-${cardId}`);
            if (countElem) {
                countElem.textContent = `(${keywords.length})`;
                countElem.style.color = '#10B981';
                countElem.style.fontWeight = 'bold';
                countElem.style.transition = 'color 0.3s ease';
                setTimeout(() => {
                    countElem.style.color = '';
                    countElem.style.fontWeight = '';
                }, 800);
            }

            input.value = ''; // Clear input
        } else {
            alert('Keyword already exists!');
        }
    };

    // ===== DRAG-AND-DROP KEYWORD REORDERING =====

    let draggedElement = null;
    let draggedIndex = null;
    let draggedCardId = null;

    window.handleDragStart = function (event) {

        const currentPlan = window.userUsageData?.plan || 'free';
        if (currentPlan === 'free') {
            event.preventDefault();
            alert("Drag & Drop Keyword Reordering is a PRO feature. Please upgrade your plan to arrange keywords for better SEO.");
            openUpgradeModal('pro');
            return;
        }

        draggedElement = event.target;
        draggedIndex = parseInt(draggedElement.dataset.index);
        draggedCardId = draggedElement.dataset.cardId;

        // Add visual class
        draggedElement.classList.add('dragging');

        // Set drag data
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/html', draggedElement.innerHTML);

        // Add class to keywords container
        const keywordsContainer = draggedElement.closest('.meta-keywords');
        if (keywordsContainer) {
            keywordsContainer.classList.add('drag-active');
        }
    };

    window.handleDragEnd = function (event) {
        // Remove visual classes
        if (draggedElement) {
            draggedElement.classList.remove('dragging');
        }

        // Remove all drag-over classes
        document.querySelectorAll('.meta-keyword-pill.drag-over').forEach(pill => {
            pill.classList.remove('drag-over');
        });

        // Remove drag-active class from container
        const keywordsContainer = event.target.closest('.meta-keywords');
        if (keywordsContainer) {
            keywordsContainer.classList.add('drag-active');
        }

        // Reset drag state
        draggedElement = null;
        draggedIndex = null;
        draggedCardId = null;
    };

    window.handleDragOver = function (event) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';

        const target = event.target.closest('.meta-keyword-pill');
        if (!target || target === draggedElement) return;

        // Remove drag-over class from all pills
        document.querySelectorAll('.meta-keyword-pill.drag-over').forEach(pill => {
            if (pill !== target) {
                pill.classList.remove('drag-over');
            }
        });

        // Add drag-over class to current target
        target.classList.add('drag-over');
    };

    window.handleDrop = function (event) {
        event.preventDefault();
        event.stopPropagation();

        const target = event.target.closest('.meta-keyword-pill');
        if (!target || target === draggedElement) return;

        const targetIndex = parseInt(target.dataset.index);
        const targetCardId = target.dataset.cardId;

        // Make sure we're in the same card
        if (targetCardId !== draggedCardId) return;

        // Remove drag-over class
        target.classList.remove('drag-over');

        // Reorder keywords
        reorderKeywordsManual(draggedCardId, draggedIndex, targetIndex);
    };

    // Helper function to reorder keywords in the data array (Renamed to avoid conflict)
    function reorderKeywordsManual(cardId, fromIndex, toIndex) {
        const fileData = uploadedFilesData.find(f => f.id === cardId);
        if (!fileData || !fileData.keywords) return;

        // Split keywords into array (Robust handling)
        let keywords = Array.isArray(fileData.keywords)
            ? fileData.keywords
            : fileData.keywords.split(',').map(k => k.trim()).filter(k => k);

        // Validate indices
        if (fromIndex < 0 || fromIndex >= keywords.length || toIndex < 0 || toIndex >= keywords.length) {
            return;
        }

        // If same position, do nothing
        if (fromIndex === toIndex) return;

        // Move the keyword from source to destination
        const [movedKeyword] = keywords.splice(fromIndex, 1);
        keywords.splice(toIndex, 0, movedKeyword);

        // Update the file data
        fileData.keywords = keywords.join(', ');

        // Update the display
        updateKeywordsDisplay(cardId);

        // Optional: Show a subtle success indicator
        const card = document.getElementById(cardId);
        if (card) {
            const keywordCountElem = document.getElementById(`keyword-count-${cardId}`);
            if (keywordCountElem) {
                // Flash the count to indicate change
                keywordCountElem.style.color = '#F97316';
                setTimeout(() => {
                    keywordCountElem.style.color = '';
                }, 500);
            }
        }
    }

    window.updateTitle = function (element) {
        const card = element.closest('.file-preview-card');
        if (!card) return;
        const cardId = card.id;

        const fileData = uploadedFilesData.find(f => f.id === cardId);
        if (!fileData) return;

        fileData.title = element.innerText.trim();

        // Update Count
        const count = fileData.title.split(/\s+/).filter(w => w.length > 0).length;
        const countElem = document.getElementById(`title-count-${card.id}`);
        if (countElem) countElem.textContent = `(${count})`;

        // Show/hide clarity check button based on content
        const clarityBtn = document.getElementById(`check-clarity-btn-${cardId}`);
        if (clarityBtn) {
            if (fileData.title.length > 0) {
                clarityBtn.style.display = 'inline-flex';
            } else {
                clarityBtn.style.display = 'none';
            }
        }

        // Update SEO Score
        if (typeof calculateSeoScore === 'function' && typeof updateSeoMeter === 'function') {
            const score = calculateSeoScore(fileData);
            updateSeoMeter(cardId, score);
        }
    };

    window.fixSpamWithAI = async function (cardId) {
        const card = document.getElementById(cardId);
        if (!card) return;

        const fileData = uploadedFilesData.find(f => f.id === cardId);
        if (!fileData) return;

        const warningBanner = card.querySelector('.spam-shield-warning');
        let originalBtnHtml = '';
        if (warningBanner) {
            const btn = warningBanner.querySelector('button');
            if (btn) {
                originalBtnHtml = btn.innerHTML;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Fixing...';
                btn.disabled = true;
            }
        }

        let authHeaders = {};
        const user = auth.currentUser;
        let accessToken = "";
        if (user) {
            try {
                accessToken = await user.getIdToken();
                authHeaders["Authorization"] = `Bearer ${accessToken}`;
            } catch (e) {
                console.warn("Could not get ID token:", e);
            }
        }

        // Gather existing data
        const currentTitle = fileData.title || "";
        const currentKeywords = fileData.keywords || "";

        // Gather conflicting titles from other files to avoid them
        const otherProcessed = uploadedFilesData.filter(f => f.id !== cardId && f.title && f.title !== 'Error');
        const avoidTitles = otherProcessed.map(f => f.title).join(" || ");

        const promptText = `You are a professional stock photography SEO expert. 
                The following metadata is triggering a "Duplicate/Spam" warning because it is too similar to other images in the same batch.
                
                Current Title: "${currentTitle}"
                Current Keywords: "${currentKeywords}"
                Other titles to strictly AVOID copying: "${avoidTitles.substring(0, 400)}"
                
                TASK:
                1. Rewrite the Title to be completely unique, engaging, and SEO-friendly (10-20 words). Do not use the exact same sentence structure as before.
                2. Shuffle the keywords, replace generic ones with highly specific synonyms, and return 35-45 keywords.
                
                Return ONLY valid JSON in this exact format:
                {"title": "New Unique Title", "keywords": "keyword1, keyword2, keyword3, ..."}
                Do not include markdown blocks.`;

        try {
            const response = await fetch("https://metagen-pro-api.metagenp.workers.dev/generate", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...authHeaders
                },
                body: JSON.stringify({
                    action: "generate", // Using generic generation action
                    prompt: promptText,
                    provider: document.getElementById('aiProviderSelect')?.value || 'groq',
                    email: user?.email || "unknown",
                    deviceInfo: navigator.userAgent
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP ${response.status}`);
            }

            const data = await response.json();

            let generatedText = data.text || data.metadata || (data.choices && data.choices[0].message.content) || (data.candidates && data.candidates[0].content.parts[0].text) || "";

            // Clean JSON
            let cleanedJsonString = generatedText.replace(/^```json\s*|```$/g, '').trim();
            const jsonStart = cleanedJsonString.indexOf('{');
            const jsonEnd = cleanedJsonString.lastIndexOf('}');
            if (jsonStart !== -1 && jsonEnd !== -1) {
                cleanedJsonString = cleanedJsonString.substring(jsonStart, jsonEnd + 1);
            }

            const fixedData = JSON.parse(cleanedJsonString);

            // Update UI and Data
            if (fixedData.title) {
                fileData.title = fixedData.title;
                const titleEl = card.querySelector('.meta-title');
                if (titleEl) {
                    titleEl.textContent = fixedData.title;
                    updateTitle(titleEl);
                }
            }

            if (fixedData.keywords) {
                fileData.keywords = Array.isArray(fixedData.keywords) ? fixedData.keywords.join(', ') : fixedData.keywords;

                // Reset keyword scores for new keywords
                fileData.keywordScores = {};
                fileData.keywords.split(',').forEach(k => {
                    fileData.keywordScores[k.trim().toLowerCase()] = 100;
                });

                updateKeywordsDisplay(cardId);
            }

            // Remove the warning banner if fixed successfully
            if (warningBanner) {
                warningBanner.remove();
            }

            // Optional: Re-check spam just in case (Will recreate banner if still spam)
            checkSpamDuplicates(fileData, card, true);

        } catch (error) {
            console.error("AI Spam Fix Error:", error);
            alert("Failed to fix spam metadata: " + error.message);
            if (warningBanner) {
                const btn = warningBanner.querySelector('button');
                if (btn) {
                    btn.innerHTML = originalBtnHtml;
                    btn.disabled = false;
                }
            }
        }
    };

    window.fixTitleWithAI = async function (cardId) {
        let currentPlan = 'free';
        if (window.userUsageData && window.userUsageData.plan) {
            currentPlan = window.userUsageData.plan.toLowerCase();
        }
        const user = auth.currentUser;
        if (user && currentPlan === 'free') {
            try {
                const profileDoc = await db.collection('users').doc(user.email.toLowerCase()).get();
                const profileData = profileDoc.exists ? profileDoc.data() : null;
                if (profileData && profileData.plan) {
                    currentPlan = profileData.plan.toLowerCase();
                }
            } catch (e) {
                console.warn('Plan check failed:', e);
            }
        }
        const isPaidPlan = (currentPlan === 'pro' || currentPlan === 'premium' || currentPlan === 'agency');

        if (!isPaidPlan) {
            alert("Upgrade to PRO/PREMIUM plan. AI Fix function are for pro & premium users only.");
            if (typeof scrollToPricing === 'function') {
                scrollToPricing();
            }
            return;
        }
        const card = document.getElementById(cardId);
        if (!card) return;

        const fileData = uploadedFilesData.find(f => f.id === cardId);
        if (!fileData) return;

        const titleText = (fileData.title || "").trim();
        if (!titleText) {
            alert("Please generate a title first.");
            return;
        }

        const fixBtn = document.getElementById(`clarity-fix-btn-${cardId}`);
        const originalHtml = fixBtn ? fixBtn.innerHTML : '';
        if (fixBtn) fixBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Fixing...';

        let authHeaders = {};
        if (user) {
            try {
                const token = await user.getIdToken();
                authHeaders["Authorization"] = `Bearer ${token}`;
            } catch (e) {
                console.warn("Could not get ID token:", e);
            }
        }

        try {
            const response = await fetch("https://metagen-pro-api.metagenp.workers.dev/api/fix-title-clarity", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...authHeaders
                },
                body: JSON.stringify({ title: titleText })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP ${response.status}`);
            }

            const data = await response.json();

            if (data.fixedTitle) {
                fileData.title = data.fixedTitle;
                const titleEl = card.querySelector('.meta-title');
                if (titleEl) {
                    titleEl.textContent = data.fixedTitle;
                    updateTitle(titleEl);
                }
                // Re-run the clarity check to show updated scores
                await checkTitleClarity(cardId);
            }
        } catch (error) {
            console.error("AI Fix Error:", error);
            alert("Failed to fix title: " + error.message);
        } finally {
            if (fixBtn) fixBtn.innerHTML = originalHtml;
        }
    };

    window.checkTitleClarity = async function (cardId) {
        const card = document.getElementById(cardId);
        if (!card) return;

        const fileData = uploadedFilesData.find(f => f.id === cardId);
        if (!fileData) return;

        const titleText = (fileData.title || "").trim();
        if (!titleText) {
            alert("Please write or generate a title first.");
            return;
        }

        const container = document.getElementById(`clarity-checker-container-${cardId}`);
        const grammarValue = document.getElementById(`clarity-grammar-value-${cardId}`);
        const grammarBar = document.getElementById(`clarity-grammar-bar-${cardId}`);
        const appealValue = document.getElementById(`clarity-appeal-value-${cardId}`);
        const appealBar = document.getElementById(`clarity-appeal-bar-${cardId}`);
        const feedbackEl = document.getElementById(`clarity-feedback-${cardId}`);
        const suggestionsEl = document.getElementById(`clarity-suggestions-${cardId}`);
        const lockOverlay = document.getElementById(`clarity-lock-overlay-${cardId}`);

        if (container) {
            container.style.display = 'block';
        }

        // Temporary loading state
        if (grammarValue) grammarValue.textContent = "...";
        if (grammarBar) {
            grammarBar.style.width = "20%";
            grammarBar.className = "clarity-progress-fill medium";
        }
        if (appealValue) appealValue.textContent = "...";
        if (appealBar) {
            appealBar.style.width = "20%";
            appealBar.className = "clarity-progress-fill medium";
        }
        if (feedbackEl) feedbackEl.innerHTML = '<span style="color: var(--text-secondary);"><i class="fas fa-spinner fa-spin"></i> Analyzing title quality...</span>';
        if (suggestionsEl) suggestionsEl.innerHTML = "";
        if (lockOverlay) lockOverlay.style.display = 'none';

        let authHeaders = {};
        const user = auth.currentUser;
        if (user) {
            try {
                const token = await user.getIdToken();
                authHeaders["Authorization"] = `Bearer ${token}`;
            } catch (e) {
                console.warn("Could not get ID token:", e);
            }
        }

        try {
            const response = await fetch("https://metagen-pro-api.metagenp.workers.dev/api/check-title-clarity", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...authHeaders
                },
                body: JSON.stringify({ title: titleText })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP ${response.status}`);
            }

            const data = await response.json();

            const gScore = parseInt(data.grammarScore) || 0;
            const aScore = parseInt(data.appealScore) || 0;

            if (grammarValue) grammarValue.textContent = `${gScore}%`;
            if (grammarBar) {
                grammarBar.style.width = `${gScore}%`;
                grammarBar.className = "clarity-progress-fill " + (gScore >= 80 ? "excellent" : gScore >= 50 ? "medium" : "low");
            }

            if (appealValue) appealValue.textContent = `${aScore}%`;
            if (appealBar) {
                appealBar.style.width = `${aScore}%`;
                appealBar.className = "clarity-progress-fill " + (aScore >= 80 ? "excellent" : aScore >= 50 ? "medium" : "low");
            }

            if (feedbackEl) {
                feedbackEl.textContent = data.grammarFeedback || "";
            }

            if (suggestionsEl) {
                suggestionsEl.innerHTML = "";
                const suggestions = data.appealSuggestions || [];
                suggestions.forEach(s => {
                    if (!s || s.trim().toLowerCase() === "locked") return;
                    const li = document.createElement("li");
                    li.textContent = s;
                    suggestionsEl.appendChild(li);
                });
            }

            // Check user tier
            let dbPlan = "free";
            if (user) {
                try {
                    const profileDoc = await db.collection('users').doc(user.email.toLowerCase()).get();
                    const profileData = profileDoc.exists ? profileDoc.data() : null;
                    dbPlan = (profileData?.plan || '').toLowerCase();
                } catch (e) { console.warn('Plan check failed:', e); }
            }
            if (dbPlan !== 'pro' && dbPlan !== 'premium' && dbPlan !== 'agency') dbPlan = 'free';
            const isPaidPlan = (dbPlan === 'pro' || dbPlan === 'premium' || dbPlan === 'agency');

            if (!isPaidPlan) {
                if (lockOverlay) lockOverlay.style.display = 'flex';
                if (feedbackEl) feedbackEl.style.filter = 'blur(4px)';
                if (suggestionsEl) suggestionsEl.style.filter = 'blur(4px)';
            } else {
                if (lockOverlay) lockOverlay.style.display = 'none';
                if (feedbackEl) feedbackEl.style.filter = 'none';
                if (suggestionsEl) suggestionsEl.style.filter = 'none';
            }

        } catch (error) {
            console.error("Clarity Check Error:", error);
            if (feedbackEl) {
                feedbackEl.innerHTML = `<span style="color: #EF4444;">Error: ${error.message}</span>`;
            }
            if (grammarValue) grammarValue.textContent = "0%";
            if (grammarBar) grammarBar.style.width = "0%";
            if (appealValue) appealValue.textContent = "0%";
            if (appealBar) appealBar.style.width = "0%";
        }
    };

    // Override copyToClipboard to handle removal of delete buttons
    window.copyToClipboard = function (button, type) {
        const card = button.closest('.file-preview-card');
        let text = '';

        if (type === 'title') {
            text = card.querySelector('.meta-title').textContent;
        } else if (type === 'description') {
            text = card.querySelector('.meta-description').textContent;
        } else if (type === 'style') {
            text = card.querySelector('.meta-style-container').textContent.trim();
        } else if (type === 'mood') {
            text = card.querySelector('.meta-mood-container').textContent.trim();
        } else if (type === 'keywords') {
            const pillContainer = card.querySelector('.meta-keywords');
            if (!pillContainer) return;

            // Clone pills to handle removal of badges and buttons
            text = Array.from(pillContainer.querySelectorAll('.meta-keyword-pill')).map(pill => {
                const clone = pill.cloneNode(true);

                const badge = clone.querySelector('.demand-badge');
                if (badge) badge.remove();

                const scoreSpan = clone.querySelector('.keyword-score');
                if (scoreSpan) scoreSpan.remove();

                const removeBtn = clone.querySelector('.keyword-remove-btn');
                if (removeBtn) removeBtn.remove();

                return clone.textContent.trim();
            }).filter(t => t).join(', ');
        }

        if (text) navigator.clipboard.writeText(text).then(() => {
            const originalText = button.innerHTML;
            button.innerHTML = '<i class="icon-check"></i>Copied!';
            setTimeout(() => { button.innerHTML = originalText; }, 1500);
        });
    };
    // --- NEW: Export & Share Features ---

    // Helper to get a ready-to-save File object with metadata embedded
    // Helper: Escape XML characters
    function escapeXml(unsafe) {
        if (typeof unsafe !== 'string') return "";
        return unsafe.replace(/[<>&'"]/g, function (c) {
            switch (c) {
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '&': return '&amp;';
                case '\'': return '&apos;';
                case '"': return '&quot;';
            }
        });
    }

    async function getEmbeddedFile(fileData) {
        let mimeType = fileData.fileObject.type;
        let blob;
        let filename = fileData.name;

        if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
            // JPEG Embedding
            blob = await new Promise(async (resolve, reject) => {
                const reader = new FileReader();
                reader.onload = async function (e) {
                    try {
                        let imageDataUrl = e.target.result;
                        let exifObj;
                        try {
                            exifObj = piexif.load(imageDataUrl);
                        } catch (err) {
                            imageDataUrl = await new Promise((res, rej) => {
                                const img = new Image();
                                img.onload = () => {
                                    const canvas = document.createElement('canvas');
                                    canvas.width = img.width; canvas.height = img.height;
                                    const ctx = canvas.getContext('2d');
                                    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
                                    ctx.drawImage(img, 0, 0);
                                    res(canvas.toDataURL('image/jpeg', 0.95));
                                };
                                img.onerror = rej;
                                img.src = e.target.result;
                            });
                        }
                        if (!exifObj) exifObj = { "0th": {}, "Exif": {}, "GPS": {}, "1st": {}, "thumbnail": null };

                        function toUTF16LE(str) {
                            const bytes = [];
                            for (let i = 0; i < str.length; i++) {
                                const code = str.charCodeAt(i);
                                bytes.push(code & 0xff);
                                bytes.push(code >> 8);
                            }
                            bytes.push(0, 0); // Null terminator
                            return bytes;
                        }

                        const keywordsString = (fileData.keywords || "").split(',').map(k => k.trim()).join(';');

                        // Explicitly DELETE conflicting ASCII tags so Windows relies on XPTitle (Unicode)
                        delete exifObj["0th"][piexif.ImageIFD.ImageDescription];
                        delete exifObj["0th"][piexif.ImageIFD.DocumentName];

                        exifObj["0th"][piexif.ImageIFD.XPSubject] = toUTF16LE(fileData.description || "");
                        exifObj["0th"][piexif.ImageIFD.XPKeywords] = toUTF16LE(keywordsString);
                        exifObj["0th"][piexif.ImageIFD.XPAuthor] = toUTF16LE("MetaGen Pro");
                        exifObj["0th"][piexif.ImageIFD.XPTitle] = toUTF16LE(fileData.title || "");

                        const exifBytes = piexif.dump(exifObj);
                        const newImageDataUrl = piexif.insert(exifBytes, imageDataUrl);

                        // 2. Construct XMP Packet
                        const keywordsArr = (fileData.keywords || "").split(',').map(k => k.trim()).filter(Boolean);
                        const titleStr = escapeXml(fileData.title || "");
                        const descStr = escapeXml(fileData.description || "");
                        const keywordsList = keywordsArr.map(k => `<rdf:li>${escapeXml(k)}</rdf:li>`).join('');

                        const xmpContent = `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.6-c138 79.159824, 2016/09/14-01:09:01">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <dc:title>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">${titleStr}</rdf:li>
    </rdf:Alt>
   </dc:title>
   <dc:description>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">${descStr}</rdf:li>
    </rdf:Alt>
   </dc:description>
   <dc:subject>
    <rdf:Bag>
     ${keywordsList}
    </rdf:Bag>
   </dc:subject>
   <photoshop:Headline>${titleStr}</photoshop:Headline>
   <photoshop:Description>${descStr}</photoshop:Description>
   <xmp:CreatorTool>MetaGen Pro</xmp:CreatorTool>
   <xmp:CreateDate>${new Date().toISOString()}</xmp:CreateDate>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;

                        // 3. Insert XMP into JPEG
                        function insertXmp(dataUrl, xmp) {
                            const header = "data:image/jpeg;base64,";
                            if (!dataUrl.startsWith(header)) return dataUrl;
                            const raw = atob(dataUrl.substring(header.length));
                            const len = raw.length;
                            const arr = new Uint8Array(len);
                            for (let i = 0; i < len; i++) arr[i] = raw.charCodeAt(i);

                            const packet = `<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>${xmp}<?xpacket end="w"?>`;

                            // FIX: UTF-8 Encode the packet
                            let packetBytes;
                            if (typeof TextEncoder !== 'undefined') {
                                packetBytes = new TextEncoder().encode(packet);
                            } else {
                                const uriComp = encodeURIComponent(packet);
                                const bytes = [];
                                for (let i = 0; i < uriComp.length; i++) {
                                    const c = uriComp.charCodeAt(i);
                                    if (c === 37) { // %
                                        bytes.push(parseInt(uriComp.substr(i + 1, 2), 16));
                                        i += 2;
                                    } else {
                                        bytes.push(c);
                                    }
                                }
                                packetBytes = new Uint8Array(bytes);
                            }

                            const ns = "http://ns.adobe.com/xap/1.0/\0";
                            const segLen = 2 + ns.length + packetBytes.length;
                            const seg = new Uint8Array(segLen + 2);
                            seg[0] = 0xFF; seg[1] = 0xE1;
                            seg[2] = (segLen >> 8) & 0xFF; seg[3] = segLen & 0xFF;

                            let off = 4;
                            for (let i = 0; i < ns.length; i++) seg[off++] = ns.charCodeAt(i);
                            seg.set(packetBytes, off);

                            // Splice after Exif if present, else after SOI
                            let pos = 2; // After SOI
                            let finalArr = new Uint8Array(arr.length + seg.length);

                            while (pos < arr.length) {
                                if (arr[pos] === 0xFF && arr[pos + 1] === 0xE1) {
                                    // Check if Exif
                                    const sL = (arr[pos + 2] << 8) | arr[pos + 3];
                                    if (arr[pos + 4] === 0x45 && arr[pos + 5] === 0x78) { // "Ex..."
                                        pos += 2 + sL; // Skip Exif
                                        continue;
                                    }
                                }
                                break;
                            }

                            finalArr.set(arr.subarray(0, pos), 0);
                            finalArr.set(seg, pos);
                            finalArr.set(arr.subarray(pos), pos + seg.length);

                            let b = "";
                            for (let i = 0; i < finalArr.length; i++) b += String.fromCharCode(finalArr[i]);
                            return header + btoa(b);
                        }

                        const finalDataUrl = insertXmp(newImageDataUrl, xmpContent);

                        // Convert back to Blob
                        const byteString = atob(finalDataUrl.split(',')[1]);
                        const ab = new ArrayBuffer(byteString.length);
                        const ia = new Uint8Array(ab);
                        for (let i = 0; i < byteString.length; i++) {
                            ia[i] = byteString.charCodeAt(i);
                        }
                        resolve(new Blob([ab], { type: 'image/jpeg' }));
                    } catch (error) { reject(error); }
                };
                reader.onerror = reject;
                reader.readAsDataURL(fileData.fileObject);
            });
            filename = filename.replace(/(\.[\w\d_-]+)$/i, '_meta$1');

        } else if (mimeType === 'image/png' || filename.toLowerCase().endsWith('.png')) {
            // PNG Embedding
            blob = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const originalBytes = new Uint8Array(e.target.result);
                        const iendOffset = findIendChunkOffset(originalBytes);
                        if (iendOffset === -1) throw new Error("Could not find IEND chunk.");
                        const contentBeforeIEND = originalBytes.subarray(0, iendOffset);
                        const iendChunk = originalBytes.subarray(iendOffset);
                        const chunksToEmbed = [
                            createTextChunk("Title", fileData.title || ""),
                            createTextChunk("Description", fileData.description || ""),
                            createTextChunk("Keywords", fileData.keywords || ""),
                            createTextChunk("Author", "MetaGen Pro"),
                            createTextChunk("Software", "MetaGen Pro v5"),
                            createTextChunk("Copyright", "MetaGen Pro"),
                            createTextChunk("Creation Time", new Date().toISOString())
                        ];
                        const xmpChunk = createXmpChunk(fileData.title || "", fileData.description || "", fileData.keywords || "");
                        const newPngBytes = concatArrays([contentBeforeIEND, ...chunksToEmbed, xmpChunk, iendChunk]);
                        resolve(new Blob([newPngBytes], { type: 'image/png' }));
                    } catch (error) { reject(error); }
                };
                reader.onerror = reject;
                reader.readAsArrayBuffer(fileData.fileObject);
            });
            filename = filename.replace(/(\.png)$/i, '_meta$1');

        } else if (mimeType === 'image/svg+xml' || filename.toLowerCase().endsWith('.svg')) {
            // SVG Embedding
            blob = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const svgContent = e.target.result;
                        const parser = new DOMParser();
                        const xmlDoc = parser.parseFromString(svgContent, "image/svg+xml");
                        const svgRoot = xmlDoc.documentElement;

                        let titleNode = svgRoot.querySelector("title");
                        if (!titleNode) { titleNode = xmlDoc.createElementNS("http://www.w3.org/2000/svg", "title"); svgRoot.insertBefore(titleNode, svgRoot.firstChild); }
                        titleNode.textContent = fileData.title || "";

                        let descNode = svgRoot.querySelector("desc");
                        if (!descNode) { descNode = xmlDoc.createElementNS("http://www.w3.org/2000/svg", "desc"); svgRoot.insertBefore(descNode, titleNode.nextSibling); }
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

                        const xmpContent = `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.6-c138 79.159824, 2016/09/14-01:09:01"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><dc:format>image/svg+xml</dc:format><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${title}</rdf:li></rdf:Alt></dc:title><dc:description><rdf:Alt><rdf:li xml:lang="x-default">${description}</rdf:li></rdf:Alt></dc:description><dc:subject><rdf:Bag>${keywordsRdf}</rdf:Bag></dc:subject><photoshop:Headline>${title}</photoshop:Headline><photoshop:Description>${description}</photoshop:Description><xmp:CreatorTool>MetaGen Pro</xmp:CreatorTool><xmp:CreateDate>${new Date().toISOString()}</xmp:CreateDate></rdf:Description></rdf:RDF></x:xmpmeta>`;
                        const xmpWithPacket = `<metadata id="metagen-data"><?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>${xmpContent}<?xpacket end="w"?></metadata>`;

                        svgString = svgString.replace(/<metadata[^>]*id="metagen-placeholder"[^>]*>(.*?)<\/metadata>|<metadata[^>]*id="metagen-placeholder"[^>]*\/>/si, xmpWithPacket);
                        if (!svgString.startsWith('<?xml')) { svgString = '<?xml version="1.0" encoding="utf-8"?>\n' + svgString; }

                        resolve(new Blob([svgString], { type: "image/svg+xml;charset=utf-8" }));
                    } catch (error) { reject(error); }
                };
                reader.onerror = reject;
                reader.readAsText(fileData.fileObject);
            });
            filename = filename.replace(/(\.svg)$/i, '_meta$1');
        } else if (fileData.name && fileData.name.toLowerCase().endsWith('.eps')) {
            // --- NEW: EPS Embedding via Server ---
            blob = await new Promise(async (resolve, reject) => {
                try {
                    const formData = new FormData();
                    formData.append('file', fileData.fileObject);
                    formData.append('title', fileData.title || '');
                    formData.append('description', fileData.description || '');
                    formData.append('keywords', fileData.keywords || '');

                    const response = await fetch('https://metagen-eps-server.onrender.com/api/embed-eps', {
                        method: 'POST',
                        body: formData
                    });

                    if (!response.ok) throw new Error("Failed to embed EPS metadata on server.");

                    const epsBlob = await response.blob();
                    resolve(epsBlob);
                } catch (e) {
                    reject(e);
                }
            });
            filename = filename.replace(/(\.eps)$/i, '_meta$1');
            mimeType = "application/postscript";

        } else if (fileData.isVideo) {
            // Videos don't support direct embedding in this tool yet, return original
            return fileData.fileObject;
        } else if (fileData.isAiFile) {
            throw new Error("Direct embedding into .ai files is not supported. Please use the Copy buttons.");
        } else {
            throw new Error("Unsupported file format for embedding.");
        }

        return new File([blob], filename, { type: mimeType });
    }

    // Save to Local Folder Function
    async function saveToLocalFolder() {
        const plan = (window.userUsageData?.plan || 'free').toLowerCase();
        if (plan === 'free') {
            alert("Upgrade to PRO/PREMIUM plan. Save to Folder features are for pro & premium users only.");
            if (typeof scrollToPricing === 'function') scrollToPricing();
            return;
        }

        if (!window.showDirectoryPicker) {
            alert("Your browser does not support the File System Access API. Please use Chrome, Edge, or Opera.");
            return;
        }

        // Filter files to save (eps যুক্ত করা হয়েছে)
        const filesToSave = uploadedFilesData.filter(f =>
            f.title && f.title !== "Error" &&
            (
                (f.fileObject.type && (['image/jpeg', 'image/jpg', 'image/png', 'image/svg+xml'].includes(f.fileObject.type) || f.fileObject.type.startsWith('video/'))) ||
                (f.name && /\.(png|svg|jpg|jpeg|eps|mp4|mov|avi|webm|mkv)$/i.test(f.name))
            )
        );

        if (filesToSave.length === 0) {
            alert("No processable files found to save.");
            return;
        }

        try {
            // ১. [মূল ফিক্স] ফোল্ডার সিলেক্ট করার সাথেই 'readwrite' পারমিশন চেয়ে নেওয়া হচ্ছে!
            const dirHandle = await window.showDirectoryPicker({
                mode: 'readwrite'
            });

            const btn = document.getElementById('saveToFolderButton');
            const originalText = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="icon-spinner"></i> ' + getTrans('saving');

            let savedCount = 0;
            for (const fileData of filesToSave) {
                try {
                    btn.innerHTML = `<i class="icon-spinner"></i> ${getTrans('saving')} ${savedCount + 1}/${filesToSave.length}`;

                    // ২. ফাইল এম্বেড করা (EPS এর ক্ষেত্রে সার্ভার থেকে হয়ে আসবে)
                    const embeddedFile = await getEmbeddedFile(fileData);

                    // ৩. ফোল্ডারে সেভ করা (এখন আর পারমিশন চাইবে না, কারণ আগেই নেওয়া হয়েছে)
                    const fileHandle = await dirHandle.getFileHandle(embeddedFile.name, { create: true });
                    const writable = await fileHandle.createWritable();
                    await writable.write(embeddedFile);
                    await writable.close();

                    savedCount++;
                } catch (err) {
                    console.error(`Failed to save ${fileData.name}:`, err);
                }
            }

            alert(`Successfully saved ${savedCount} files to the selected folder!`);

            btn.disabled = false;
            btn.innerHTML = originalText;

        } catch (error) {
            // যদি ইউজার ফোল্ডার সিলেক্ট না করে Cancel করে দেয়, তাহলে এরর দেখাবে না
            if (error.name !== 'AbortError') {
                console.error("File System Access Error:", error);
                alert("An error occurred while saving files: " + error.message);

                // বাটন আগের অবস্থায় ফিরিয়ে আনা
                const btn = document.getElementById('saveToFolderButton');
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-folder-open"></i> <span data-i18n="save_folder">Save to Folder</span>';
                }
            }
        }
    }

    // Wire up new buttons
    const saveToFolderBtn = document.getElementById('saveToFolderButton');
    if (saveToFolderBtn) {
        saveToFolderBtn.onclick = saveToLocalFolder;

        // Check support
        if (!window.showDirectoryPicker) {
            saveToFolderBtn.style.display = 'none'; // Hide if not supported
        }
    }

    const shareFilesBtn = document.getElementById('shareFilesButton');
    if (shareFilesBtn) {
        // Check support for file sharing
        if (!navigator.canShare) {
            shareFilesBtn.style.display = 'none';
        }

        shareFilesBtn.onclick = async () => {
            const filesToShare = uploadedFilesData.filter(f =>
                f.title && f.title !== "Error" &&
                (
                    (f.fileObject.type && ['image/jpeg', 'image/jpg', 'image/png', 'image/svg+xml'].includes(f.fileObject.type)) ||
                    (f.name && /\.(png|svg|jpg|jpeg|eps)$/i.test(f.name))
                )
            );

            if (filesToShare.length === 0) {
                alert("No processable files found to share.");
                return;
            }

            const originalText = shareFilesBtn.innerHTML;
            shareFilesBtn.disabled = true;
            shareFilesBtn.innerHTML = '<i class="icon-spinner"></i> ' + getTrans('preparing');

            try {
                const filesArray = [];
                for (const fileData of filesToShare) {
                    try {
                        const file = await getEmbeddedFile(fileData);
                        filesArray.push(file);
                    } catch (e) {
                        console.error(`Error processing ${fileData.name} for sharing:`, e);
                    }
                }

                if (filesArray.length === 0) {
                    alert("Failed to prepare files for sharing.");
                    return;
                }

                if (navigator.canShare && navigator.canShare({ files: filesArray })) {
                    await navigator.share({
                        files: filesArray,
                        title: 'MetaGen Pro Export',
                        text: 'Here are my processed files with metadata.'
                    });
                } else {
                    alert("Your browser does not support sharing these files.");
                }

            } catch (error) {
                if (error.name !== 'AbortError') {
                    console.error("Share Error:", error);
                    alert("Error sharing files: " + error.message);
                }
            } finally {
                shareFilesBtn.disabled = false;
                shareFilesBtn.innerHTML = originalText;
            }
        };
    }

    // --- Google Drive Integration ---
    const uploadToDriveBtn = document.getElementById('uploadToDriveButton');
    let tokenClient;
    let gapiInited = false;
    let gisInited = false;

    // Initialize GAPI and GSI
    function maybeInitGoogleDrive() {
        const apiKey = localStorage.getItem('googleDriveApiKey');
        const clientId = localStorage.getItem('googleDriveClientId');

        if (apiKey && clientId) {
            if (typeof gapi !== 'undefined' && !gapiInited) {
                gapi.load('client', async () => {
                    try {
                        await gapi.client.init({
                            apiKey: apiKey,
                            discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
                        });
                        gapiInited = true;
                    } catch (err) {
                        console.error("GAPI Init Error:", err);
                    }
                });
            }

            if (typeof google !== 'undefined' && !gisInited) {
                tokenClient = google.accounts.oauth2.initTokenClient({
                    client_id: clientId,
                    scope: 'https://www.googleapis.com/auth/drive.file',
                    callback: (resp) => {
                        if (resp.error !== undefined) {
                            throw (resp);
                        }
                        // Token acquired, proceed to upload (handled in button click)
                    },
                });
                gisInited = true;
            }
        }
    }

    // Try to init on load if keys exist
    setTimeout(maybeInitGoogleDrive, 1000); // Give scripts time to load

    if (uploadToDriveBtn) {
        // Initial check for keys
        if (!localStorage.getItem('googleDriveApiKey') || !localStorage.getItem('googleDriveClientId')) {
            // We could hide button or show setup prompt on click. usage prompt on click is better.
        }

        uploadToDriveBtn.onclick = async () => {
            const apiKey = localStorage.getItem('googleDriveApiKey');
            const clientId = localStorage.getItem('googleDriveClientId');

            if (!apiKey || !clientId) {
                const setNow = confirm("Google Drive API Key and Client ID are missing. Would you like to set them now?\n\nYou need to create a project in Google Cloud Console, enable Drive API, and generate an API Key and OAuth Client ID.");
                if (setNow) {
                    const newClientId = prompt("Enter your Google Client ID:", clientId || "");
                    const newApiKey = prompt("Enter your Google API Key:", apiKey || "");
                    if (newClientId && newApiKey) {
                        localStorage.setItem('googleDriveClientId', newClientId);
                        localStorage.setItem('googleDriveApiKey', newApiKey);
                        attemptUpload();
                        maybeInitGoogleDrive(); // Re-init
                    }
                }
                return;
            }
            attemptUpload();
        };
    }

    async function attemptUpload() {
        maybeInitGoogleDrive(); // Ensure init

        // Wait briefly for init if needed (hacky but simple for now)
        if ((!gapiInited || !gisInited) && (typeof gapi !== 'undefined' && typeof google !== 'undefined')) {
            await new Promise(r => setTimeout(r, 1000));
        }

        if (!gapiInited || !gisInited) {
            alert("Google Drive API failed to initialize. Please check your Console and API Keys.");
            return;
        }

        tokenClient.callback = async (resp) => {
            if (resp.error !== undefined) {
                throw (resp);
            }
            await uploadFilesToDrive();
        };

        if (gapi.client.getToken() === null) {
            // Prompt the user to select a Google Account and ask for consent to share their data
            // when establishing a new session.
            tokenClient.requestAccessToken({ prompt: 'consent' });
        } else {
            // Skip display of account chooser and consent dialog for an existing session.
            tokenClient.requestAccessToken({ prompt: 'none' });
        }
    }

    async function uploadFilesToDrive() {
        const filesToUpload = uploadedFilesData.filter(f =>
            f.title && f.title !== "Error" &&
            (
                (f.fileObject.type && (['image/jpeg', 'image/jpg', 'image/png', 'image/svg+xml'].includes(f.fileObject.type) || f.fileObject.type.startsWith('video/'))) ||
                (f.name && /\.(png|svg|jpg|jpeg|eps|mp4|mov|avi|webm|mkv)$/i.test(f.name))
            )
        );

        if (filesToUpload.length === 0) {
            alert("No files to upload.");
            return;
        }

        const btn = document.getElementById('uploadToDriveButton');
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="icon-spinner"></i> ' + getTrans('uploading');

        let successCount = 0;

        try {
            // Create a root folder "MetaGen Pro Exports"
            let folderId = null;
            // Check if folder exists (simple query)
            const q = "name = 'MetaGen Pro Exports' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
            const response = await gapi.client.drive.files.list({ q: q, fields: 'files(id, name)' });

            if (response.result.files && response.result.files.length > 0) {
                folderId = response.result.files[0].id;
            } else {
                // Create folder
                const fileMetadata = {
                    'name': 'MetaGen Pro Exports',
                    'mimeType': 'application/vnd.google-apps.folder'
                };
                const folder = await gapi.client.drive.files.create({
                    resource: fileMetadata,
                    fields: 'id'
                });
                folderId = folder.result.id;
            }

            for (const fileData of filesToUpload) {
                btn.innerHTML = `<i class="icon-spinner"></i> ${getTrans('uploading')} ${successCount + 1}/${filesToUpload.length}`;

                const embeddedFile = await getEmbeddedFile(fileData);

                // Prepare multipart upload
                const metadata = {
                    'name': embeddedFile.name,
                    'parents': [folderId]
                };

                const accessToken = gapi.client.getToken().access_token;
                const form = new FormData();
                form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
                form.append('file', embeddedFile);

                await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                    method: 'POST',
                    headers: new Headers({ 'Authorization': 'Bearer ' + accessToken }),
                    body: form
                }).then(res => {
                    if (!res.ok) throw new Error("Upload failed");
                    successCount++;
                });
            }

            alert(`Successfully uploaded ${successCount} files to 'MetaGen Pro Exports' on Google Drive!`);

        } catch (err) {
            console.error("Upload Error:", err);
            alert("Upload failed: " + err.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }

    window.loadFTPCredentials = function (platform) {
        const savedCreds = localStorage.getItem(`ftp_creds_${platform}`);
        if (savedCreds) {
            try {
                return JSON.parse(savedCreds);
            } catch (e) {
                console.error("Error parsing saved FTP creds for", platform);
            }
        }
        return null;
    };

    const stockAgencies = {
        'shutterstock': { name: 'Shutterstock', host: 'ftp.shutterstock.com', port: '' },
        'adobestock': { name: 'Adobe Stock', host: 'sftp.contributor.adobestock.com', port: '22' },
        'Magnific': { name: 'Magnific', host: 'contributor-ftp.magnific.com', port: '60022' },
        'vecteezy': { name: 'Vecteezy', host: 'ftp.vecteezy.com', port: '' },
        'vectorstock': { name: 'VectorStock', host: 'ftp.vectorstock.com', port: '' },
        '123rf': { name: '123RF', host: 'ftp.123rf.com', port: '' },
        'pond5': { name: 'Pond5', host: 'ftp.pond5.com', port: '' }
    };

    window.handleAgencyConfigChange = function () {
        const platform = document.getElementById('ftpPlatform').value;
        const hostInput = document.getElementById('ftpHost');
        const portInput = document.getElementById('ftpPort');
        const userInput = document.getElementById('ftpUser');
        const passInput = document.getElementById('ftpPass');

        if (platform === 'custom') {
            hostInput.placeholder = "ftp.your-site.com";
            if (portInput) portInput.value = '';
        } else {
            hostInput.placeholder = stockAgencies[platform].host;
            if (portInput) portInput.value = stockAgencies[platform].port || '';
        }

        const creds = window.loadFTPCredentials(platform);
        if (creds) {
            hostInput.value = creds.host || (platform === 'custom' ? '' : stockAgencies[platform].host);
            if (portInput) portInput.value = creds.port || (platform === 'custom' ? '' : (stockAgencies[platform].port || ''));
            userInput.value = creds.user || '';
            passInput.value = creds.pass || '';
        } else {
            hostInput.value = platform === 'custom' ? '' : stockAgencies[platform].host;
            if (portInput) portInput.value = platform === 'custom' ? '' : (stockAgencies[platform].port || '');
            userInput.value = '';
            passInput.value = '';
        }
    };

    const saveCredsBtn = document.getElementById('saveAgencyCredsBtn');
    if (saveCredsBtn) {
        saveCredsBtn.onclick = function () {
            const platform = document.getElementById('ftpPlatform').value;
            const host = document.getElementById('ftpHost').value.trim();
            const port = document.getElementById('ftpPort') ? document.getElementById('ftpPort').value.trim() : '';
            const user = document.getElementById('ftpUser').value.trim();
            const pass = document.getElementById('ftpPass').value.trim();

            if (!user || !pass) {
                alert("Please enter Username and Password.");
                return;
            }

            localStorage.setItem(`ftp_creds_${platform}`, JSON.stringify({ host, port, user, pass }));
            alert(`Credentials saved for ${platform === 'custom' ? 'Custom Site' : stockAgencies[platform].name}!`);
        };
    }

    const ftpUploadBtn = document.getElementById('ftpUploadButton');
    if (ftpUploadBtn) {
        ftpUploadBtn.onclick = () => {
            window.openFtpUploadModal();
        };
    }

    const startFtpBtn = document.getElementById('startFtpBtn');
    if (startFtpBtn) {
        startFtpBtn.onclick = async function () {
            console.log("Multi-Agency Upload Process Started...");

            const selectedAgencies = Array.from(document.querySelectorAll('.ftp-upload-checkbox:checked')).map(cb => cb.value);
            const statusDiv = document.getElementById('ftpStatus');
            const progressContainer = document.getElementById('ftpProgressContainer');
            const progressBar = document.getElementById('ftpProgressBar');
            const progressFileName = document.getElementById('ftpProgressFileName');
            const progressPercent = document.getElementById('ftpProgressPercent');

            if (selectedAgencies.length === 0) {
                alert("Please select at least one agency to upload.");
                return;
            }

            const filesToUpload = uploadedFilesData.filter(f => f.title && f.title !== "Error");
            if (filesToUpload.length === 0) {
                alert("Please process metadata for the images first!");
                return;
            }

            this.disabled = true;
            const originalBtnContent = this.innerHTML;
            progressContainer.style.display = 'block';
            statusDiv.innerHTML = `<span style="color: #F97316;">${getTrans('initializing')}...</span>`;

            let totalSuccess = 0;
            let totalFailed = 0;
            let totalFilesCount = filesToUpload.length * selectedAgencies.length;
            let currentStep = 0;

            for (const platform of selectedAgencies) {
                const creds = window.loadFTPCredentials(platform);
                if (!creds) {
                    alert(`No credentials found for ${stockAgencies[platform].name}. Please configure and save them first.`);
                    continue;
                }

                for (let i = 0; i < filesToUpload.length; i++) {
                    const fileData = filesToUpload[i];
                    currentStep++;

                    const percent = Math.round((currentStep / totalFilesCount) * 100);
                    progressBar.style.width = percent + '%';
                    progressFileName.innerText = `${stockAgencies[platform].name}: ${fileData.name}`;
                    progressPercent.innerText = percent + '%';
                    statusDiv.innerHTML = `<span style="color: #F97316;">${getTrans('uploading')} to ${stockAgencies[platform].name}...</span>`;

                    try {
                        const embeddedFile = await getEmbeddedFile(fileData);
                        const formData = new FormData();
                        formData.append('file', embeddedFile);
                        formData.append('host', creds.host.replace('sftp://', '').replace('ftp://', '').replace('ftps://', ''));
                        formData.append('port', creds.port || '');
                        formData.append('user', creds.user);
                        formData.append('pass', creds.pass);
                        const isSftp = creds.host.toLowerCase().includes('sftp') || creds.port === '60022' || creds.port === '22';
                        formData.append('protocol', isSftp ? 'sftp' : 'ftp');

                        const response = await fetch('https://metagen-eps-server.onrender.com/api/ftp-upload', {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${auth.currentUser ? await auth.currentUser.getIdToken() : ""}`
                            },
                            body: formData
                        });

                        let result;
                        try {
                            result = await response.json();
                        } catch (e) { result = { success: false, error: 'Server returned invalid response' }; }

                        if (response.ok && result.success) {
                            totalSuccess++;
                            statusDiv.innerHTML = `<span style="color: #10B981;">&#10004; ${fileData.name} uploaded to ${stockAgencies[platform]?.name || platform}</span>`;
                        } else {
                            totalFailed++;
                            const errDetail = result.error || `HTTP ${response.status}`;
                            console.error(`Upload failed for ${platform} - ${fileData.name}: ${errDetail}`);
                            statusDiv.innerHTML = `<span style="color: #EF4444;">&#10008; ${fileData.name} failed: ${errDetail}</span>`;
                        }
                    } catch (err) {
                        totalFailed++;
                        console.error(`Upload error for ${platform}:`, err);
                        statusDiv.innerHTML = `<span style="color: #EF4444;">&#10008; ${fileData.name}: ${err.message}</span>`;
                    }
                }
            }

            // Final summary
            if (totalFailed > 0) {
                statusDiv.innerHTML = `<span style="color: #F59E0B; font-weight:bold;">&#9888; Upload Complete: ${totalSuccess} success, ${totalFailed} failed</span>`;
            } else {
                statusDiv.innerHTML = `<span style="color: #10B981; font-weight:bold;">&#10004; All uploads successful! Total: ${totalSuccess}</span>`;
            }
            setTimeout(() => {
                progressContainer.style.display = 'none';
                progressBar.style.width = '0%';
            }, 5000);

            // Success sound
            try {
                const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                const oscillator = audioCtx.createOscillator();
                const gainNode = audioCtx.createGain();
                oscillator.frequency.value = 880;
                gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 1);
                oscillator.connect(gainNode);
                gainNode.connect(audioCtx.destination);
                oscillator.start();
                oscillator.stop(audioCtx.currentTime + 1);
            } catch (e) { }

            this.disabled = false;
            this.innerHTML = originalBtnContent;
        };
    }
});
