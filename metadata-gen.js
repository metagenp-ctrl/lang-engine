// MetaGen Pro - Metadata Gen Module
document.addEventListener('DOMContentLoaded', function () {

    const previewContainer = document.getElementById('filePreviewContainer');
    const processAllButton = document.getElementById('processAllButton');
    const processAllPromptsButton = document.getElementById('processAllPromptsButton');
    const exportButton = document.getElementById('exportButton');
    const embedMetadataButton = document.getElementById('embedMetadataButton');
    const clearAllButton = document.getElementById('clearAllButton');
    if (!window.uploadedFilesData) window.uploadedFilesData = [];
    const uploadedFilesData = window.uploadedFilesData;

    // Translation using free MyMemory API (no API key required)
    window.translateText = async function (text, targetLang) {
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

    window.embedPngAndDownload = async function (fileData) {
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
    window.embedEpsAndDownload = async function (fileData) {
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
    window.embedAndDownload = async function (fileData) {
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
    // JS - Updated generateMetadata Function supporting Mistral
    window.generateMetadata = async function (fileData) {
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

            if (metadata.style && (!window.metaGenOptions || window.metaGenOptions.style)) {
                // Apply badge style
                metaStyleContainer.innerHTML = `<span class="visual-tag style-tag">${metadata.style}</span>`;
                if (styleSection) styleSection.style.display = 'flex'; // Changed to flex for new CSS
            } else {
                if (styleSection) styleSection.style.display = 'none';
            }

            if (metadata.mood && (!window.metaGenOptions || window.metaGenOptions.mode)) {
                // Apply badge style
                metaMoodContainer.innerHTML = `<span class="visual-tag mood-tag">${metadata.mood}</span>`;
                if (moodSection) moodSection.style.display = 'flex'; // Changed to flex
            } else {
                if (moodSection) moodSection.style.display = 'none';
            }

            // --- Render Advanced Insights Panel (PRO/PREMIUM Only) ---
            if (isPaidPlan && (!window.metaGenOptions || window.metaGenOptions.advancedInsights)) {
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
            } else {
                // Hide Advanced Insights if checkbox not selected
                let advancedPanel = card.querySelector('.advanced-insights-panel');
                if (advancedPanel) advancedPanel.style.display = 'none';
            }

            // Update Rejection Predictor
            const rejectionMeter = document.getElementById(`rejection-meter-${card.id}`);
            if (rejectionMeter && metadata.rejection_prediction !== undefined && (!window.metaGenOptions || window.metaGenOptions.rejection)) {
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
            } else if (rejectionMeter) {
                // Explicitly hide when checkbox not selected
                rejectionMeter.style.display = 'none';
            }

            // --- Update Platform Approval Chance ---
            const approvalChanceContainer = document.getElementById(`approval-chance-container-${card.id}`);
            if (approvalChanceContainer && metadata.rejection_prediction !== undefined && (!window.metaGenOptions || window.metaGenOptions.rejection)) {
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
            } else if (approvalChanceContainer) {
                // Explicitly hide when checkbox not selected
                approvalChanceContainer.style.display = 'none';
            }

            // Update Release Predictor
            const releaseReqContainer = document.getElementById(`release-req-${card.id}`);
            if (releaseReqContainer && (metadata.requires_model_release !== undefined || metadata.requires_property_release !== undefined) && (!window.metaGenOptions || window.metaGenOptions.releaseRequirements)) {
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
            } else if (releaseReqContainer) {
                releaseReqContainer.style.display = 'none';
            }

            // --- Hide Save Preset if not requested ---
            const savePresetContainer = card.querySelector('.keyword-preset-container');
            if (savePresetContainer && window.metaGenOptions && !window.metaGenOptions.savePreset) {
                savePresetContainer.style.display = 'none';
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
        const activePlatforms = [...document.querySelectorAll('.platform-button.active')].map(btn => btn.dataset.platform);
        const noDescriptionMode = activePlatforms.includes('adobe') || activePlatforms.includes('Magnific');
        const desc = (metadata.description || '').trim();
        const descLength = desc.length;
        if (noDescriptionMode) {
            score += 25; // Full score since it's intentionally omitted
        } else if (descLength >= 100 && descLength <= 160) {
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

    window.reorderKeywords = function (keywordsStr) {
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
});
