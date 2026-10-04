// ================================================================
// MetaGen Pro - New Features Module v1.0
// Features: Bulk CSV Export, Platform Optimization, 
//           Market Analytics, AI Content Ideas
// ================================================================

document.addEventListener('DOMContentLoaded', function () {

    if (!window.uploadedFilesData) window.uploadedFilesData = [];
    const uploadedFilesData = window.uploadedFilesData;

    // ================================================================
    // SECTION 1: ENHANCED BULK CSV EXPORT (Multi-Platform)
    // ================================================================

    // Platform-specific CSV format configurations
    const CSV_FORMATS = {
        shutterstock: {
            name: 'Shutterstock',
            headers: ['Filename', 'Description', 'Keywords', 'Categories', 'Editorial', 'Mature Content', 'Illustration'],
            maxKeywords: 50,
            maxTitleLen: 200,
            buildRow: (f) => {
                const kw = truncateKeywords(f.keywords, 50);
                return [f.name, f.title || '', kw, f.category || '', 'no', 'no', 'no'];
            }
        },
        adobe: {
            name: 'Adobe Stock',
            headers: ['Filename', 'Title', 'Keywords', 'Category', 'Releases'],
            maxKeywords: 25,
            maxTitleLen: 70,
            buildRow: (f) => {
                const kw = truncateKeywords(f.keywords, 25);
                const cat = getMappedAdobeCategoryLocal(f);
                return [f.name, (f.title || '').substring(0, 70), kw, cat, ''];
            }
        },
        freepik: {
            name: 'Freepik',
            headers: ['Filename', 'Title', 'Description', 'Tags'],
            maxKeywords: 50,
            maxTitleLen: 100,
            buildRow: (f) => {
                const kw = truncateKeywords(f.keywords, 50);
                return [f.name, (f.title || '').substring(0, 100), f.description || '', kw];
            }
        },
        istock: {
            name: 'iStock/Getty',
            headers: ['Filename', 'Title', 'Description', 'Keywords', 'Category', 'Editorial'],
            maxKeywords: 50,
            maxTitleLen: 200,
            buildRow: (f) => {
                const kw = truncateKeywords(f.keywords, 50);
                return [f.name, f.title || '', f.description || '', kw, f.category || '', 'no'];
            }
        },
        dreamstime: {
            name: 'Dreamstime',
            headers: ['Filename', 'Title', 'Description', 'Keywords'],
            maxKeywords: 50,
            maxTitleLen: 100,
            buildRow: (f) => {
                const kw = truncateKeywords(f.keywords, 50);
                return [f.name, (f.title || '').substring(0, 100), f.description || '', kw];
            }
        },
        pond5: {
            name: 'Pond5',
            headers: ['Original Filename', 'Title', 'Tags', 'Description', 'Category'],
            maxKeywords: 50,
            maxTitleLen: 70,
            buildRow: (f) => {
                const kw = truncateKeywords(f.keywords, 50);
                return [f.name, (f.title || '').substring(0, 70), kw, f.description || '', f.category || ''];
            }
        },
        vecteezy: {
            name: 'Vecteezy',
            headers: ['Filename', 'Title', 'Tags'],
            maxKeywords: 50,
            maxTitleLen: 200,
            buildRow: (f) => {
                const kw = truncateKeywords(f.keywords, 50);
                return [f.name, f.title || '', kw];
            }
        },
        '123rf': {
            name: '123RF',
            headers: ['Filename', 'Description', 'Keywords'],
            maxKeywords: 25,
            maxTitleLen: 200,
            buildRow: (f) => {
                const kw = truncateKeywords(f.keywords, 25);
                return [f.name, f.title || '', kw];
            }
        }
    };

    function truncateKeywords(keywords, maxCount) {
        if (!keywords) return '';
        const arr = keywords.split(',').map(k => k.trim()).filter(k => k);
        return arr.slice(0, maxCount).join(', ');
    }

    function getMappedAdobeCategoryLocal(fileData) {
        if (typeof getMappedAdobeCategory === 'function') {
            const catSelect = document.getElementById(`ai-category-${fileData.id}`);
            return getMappedAdobeCategory(catSelect ? catSelect.value : (fileData.adobeCategory || ''));
        }
        return fileData.category || '';
    }

    // =============== BULK EXPORT MODAL ===============
    window.openBulkExportModal = function () {
        const successfulFiles = uploadedFilesData.filter(f => f.title && f.title !== "Error");
        if (successfulFiles.length === 0) {
            if (typeof showCustomAlert === 'function') showCustomAlert("No metadata available to export. Generate metadata first.", "warning");
            else alert("No metadata available to export. Generate metadata first.");
            return;
        }

        const modal = document.getElementById('bulkExportModal');
        if (modal) {
            // Update file count
            const countEl = document.getElementById('bulkExportFileCount');
            if (countEl) countEl.textContent = successfulFiles.length;

            // Update preview
            updateBulkExportPreview();
            modal.style.display = 'flex';
        }
    };

    window.closeBulkExportModal = function () {
        const modal = document.getElementById('bulkExportModal');
        if (modal) modal.style.display = 'none';
    };

    window.updateBulkExportPreview = function () {
        const selectedPlatforms = getSelectedExportPlatforms();
        const previewEl = document.getElementById('bulkExportPreview');
        if (!previewEl) return;

        if (selectedPlatforms.length === 0) {
            previewEl.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:20px;">Select at least one platform above</div>';
            return;
        }

        const successfulFiles = uploadedFilesData.filter(f => f.title && f.title !== "Error");

        let html = selectedPlatforms.map(platform => {
            const config = CSV_FORMATS[platform];
            if (!config) return '';

            const sampleFile = successfulFiles[0];
            const row = config.buildRow(sampleFile);

            return `
                <div style="background:rgba(59,130,246,0.05); border:1px solid var(--border-color); border-radius:8px; padding:12px; margin-bottom:10px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <span style="font-weight:700; color:var(--accent-orange); font-size:0.9em;">📄 ${config.name}</span>
                        <span style="font-size:0.75em; color:var(--text-muted);">Max ${config.maxKeywords} keywords • Max ${config.maxTitleLen} chars title</span>
                    </div>
                    <div style="font-size:0.75em; color:var(--text-muted); overflow-x:auto;">
                        <code style="color:var(--accent-blue);">${config.headers.join(' | ')}</code>
                    </div>
                    <div style="font-size:0.7em; color:var(--text-primary); margin-top:6px; overflow-x:auto; white-space:nowrap;">
                        <code>${row.map(r => (r || '').substring(0, 30) + ((r || '').length > 30 ? '...' : '')).join(' | ')}</code>
                    </div>
                </div>
            `;
        }).join('');

        previewEl.innerHTML = html;
    };

    function getSelectedExportPlatforms() {
        const checkboxes = document.querySelectorAll('.bulk-export-platform-cb:checked');
        return Array.from(checkboxes).map(cb => cb.value);
    }

    window.executeBulkExport = function () {
        const selectedPlatforms = getSelectedExportPlatforms();
        if (selectedPlatforms.length === 0) {
            alert("Please select at least one platform.");
            return;
        }

        const successfulFiles = uploadedFilesData.filter(f => f.title && f.title !== "Error");
        if (successfulFiles.length === 0) {
            alert("No files to export.");
            return;
        }

        let exportedCount = 0;
        selectedPlatforms.forEach(platform => {
            const config = CSV_FORMATS[platform];
            if (!config) return;

            let csvContent = config.headers.map(h => `"${h}"`).join(',') + '\n';

            successfulFiles.forEach(fileData => {
                const row = config.buildRow(fileData);
                csvContent += row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(',') + '\n';
            });

            // Download file
            const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${config.name.replace(/[^a-zA-Z0-9]/g, '_')}_metadata_${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            exportedCount++;
        });

        if (typeof showCustomAlert === 'function') {
            showCustomAlert(`✅ ${exportedCount} CSV file(s) exported for ${successfulFiles.length} images!`, 'success');
        } else {
            alert(`${exportedCount} CSV file(s) exported for ${successfulFiles.length} images!`);
        }

        closeBulkExportModal();
    };


    // ================================================================
    // SECTION 2: PLATFORM-SPECIFIC KEYWORD OPTIMIZATION
    // ================================================================

    window.openPlatformOptimizer = function () {
        const section = document.getElementById('platformOptimizerSection');
        if (section) section.style.display = 'block';
    };

    window.runPlatformOptimization = async function () {
        const platform = document.getElementById('optimizePlatformSelect').value;
        const resultsEl = document.getElementById('platformOptResults');
        const btn = document.getElementById('runOptimizeBtn');

        const successfulFiles = uploadedFilesData.filter(f => f.title && f.title !== "Error");
        if (successfulFiles.length === 0) {
            alert("No files with metadata. Generate metadata first.");
            return;
        }

        const config = CSV_FORMATS[platform];
        if (!config) return;

        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Optimizing...';
        resultsEl.innerHTML = '<div style="text-align:center; padding:30px; color:var(--text-muted);"><i class="fas fa-spinner fa-spin fa-2x"></i><br><br>Analyzing & optimizing for ' + config.name + '...</div>';
        resultsEl.style.display = 'block';

        try {
            let optimizedResults = [];

            for (const fileData of successfulFiles) {
                const issues = [];
                const suggestions = [];
                let score = 100;

                // Title check
                const title = fileData.title || '';
                if (title.length > config.maxTitleLen) {
                    issues.push(`Title too long (${title.length}/${config.maxTitleLen} chars)`);
                    suggestions.push(`Trim title to ${config.maxTitleLen} characters`);
                    score -= 15;
                }
                if (title.length < 10) {
                    issues.push('Title too short');
                    suggestions.push('Add more descriptive words to title');
                    score -= 20;
                }

                // Keywords check
                const keywords = (fileData.keywords || '').split(',').map(k => k.trim()).filter(k => k);
                if (keywords.length > config.maxKeywords) {
                    issues.push(`Too many keywords (${keywords.length}/${config.maxKeywords})`);
                    suggestions.push(`Remove ${keywords.length - config.maxKeywords} lowest-performing keywords`);
                    score -= 10;
                }
                if (keywords.length < 5) {
                    issues.push(`Too few keywords (${keywords.length})`);
                    suggestions.push('Add more relevant keywords for better discoverability');
                    score -= 25;
                }

                // Single word keywords check
                const singleWords = keywords.filter(k => k.split(' ').length === 1);
                if (singleWords.length > keywords.length * 0.6) {
                    issues.push('Too many single-word keywords');
                    suggestions.push('Use more 2-3 word phrases for better SEO targeting');
                    score -= 10;
                }

                // Platform-specific checks
                if (platform === 'shutterstock') {
                    if (!fileData.category) {
                        issues.push('Missing Shutterstock category');
                        suggestions.push('Select a category to improve visibility');
                        score -= 15;
                    }
                } else if (platform === 'adobe') {
                    if (keywords.length > 25) {
                        issues.push('Adobe Stock only indexes first 25 keywords');
                        suggestions.push('Prioritize top 25 keywords — rest will be ignored');
                        score -= 10;
                    }
                } else if (platform === 'freepik') {
                    if (!fileData.description || fileData.description.length < 20) {
                        issues.push('Freepik values descriptions for SEO');
                        suggestions.push('Write a detailed 50-100 word description');
                        score -= 15;
                    }
                }

                // Description check
                if (!fileData.description || fileData.description.length < 20) {
                    issues.push('Description is too short or missing');
                    suggestions.push('Add a detailed description for better search ranking');
                    score -= 10;
                }

                score = Math.max(0, Math.min(100, score));

                optimizedResults.push({
                    name: fileData.name,
                    id: fileData.id,
                    score: score,
                    issues: issues,
                    suggestions: suggestions,
                    keywordCount: keywords.length,
                    maxKeywords: config.maxKeywords,
                    titleLen: title.length,
                    maxTitleLen: config.maxTitleLen
                });
            }

            // Render results
            const avgScore = Math.round(optimizedResults.reduce((sum, r) => sum + r.score, 0) / optimizedResults.length);
            const avgColor = avgScore >= 80 ? '#10B981' : avgScore >= 50 ? '#F59E0B' : '#EF4444';

            let html = `
                <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:12px; margin-bottom:20px;">
                    <div style="background:var(--bg-input); border:1px solid var(--border-color); border-radius:10px; padding:16px; text-align:center;">
                        <div style="font-size:2em; font-weight:800; color:${avgColor};">${avgScore}%</div>
                        <div style="font-size:0.8em; color:var(--text-muted);">Avg. ${config.name} Score</div>
                    </div>
                    <div style="background:var(--bg-input); border:1px solid var(--border-color); border-radius:10px; padding:16px; text-align:center;">
                        <div style="font-size:2em; font-weight:800; color:#3B82F6;">${optimizedResults.length}</div>
                        <div style="font-size:0.8em; color:var(--text-muted);">Files Analyzed</div>
                    </div>
                    <div style="background:var(--bg-input); border:1px solid var(--border-color); border-radius:10px; padding:16px; text-align:center;">
                        <div style="font-size:2em; font-weight:800; color:#F97316;">${optimizedResults.filter(r => r.issues.length > 0).length}</div>
                        <div style="font-size:0.8em; color:var(--text-muted);">Need Fixes</div>
                    </div>
                </div>
            `;

            optimizedResults.forEach(result => {
                const scoreColor = result.score >= 80 ? '#10B981' : result.score >= 50 ? '#F59E0B' : '#EF4444';
                const statusIcon = result.score >= 80 ? '✅' : result.score >= 50 ? '⚠️' : '❌';

                html += `
                    <div style="background:var(--bg-input); border:1px solid var(--border-color); border-radius:10px; padding:14px; margin-bottom:10px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                            <div style="display:flex; align-items:center; gap:8px;">
                                <span style="font-size:1.1em;">${statusIcon}</span>
                                <span style="font-weight:600; color:var(--text-primary); font-size:0.9em;">${result.name.substring(0, 35)}${result.name.length > 35 ? '...' : ''}</span>
                            </div>
                            <span style="background:${scoreColor}15; color:${scoreColor}; padding:4px 12px; border-radius:20px; font-size:0.8em; font-weight:700;">${result.score}%</span>
                        </div>
                        <div style="display:flex; gap:15px; margin-bottom:8px;">
                            <span style="font-size:0.75em; color:var(--text-muted);">Keywords: <b style="color:var(--text-primary);">${result.keywordCount}/${result.maxKeywords}</b></span>
                            <span style="font-size:0.75em; color:var(--text-muted);">Title: <b style="color:var(--text-primary);">${result.titleLen}/${result.maxTitleLen} chars</b></span>
                        </div>
                        ${result.issues.length > 0 ? `
                            <div style="background:rgba(239,68,68,0.05); border-left:3px solid #EF4444; padding:8px 12px; border-radius:0 6px 6px 0; margin-bottom:6px;">
                                ${result.issues.map(i => `<div style="font-size:0.8em; color:#EF4444; margin-bottom:2px;">⚠ ${i}</div>`).join('')}
                            </div>
                            <div style="background:rgba(16,185,129,0.05); border-left:3px solid #10B981; padding:8px 12px; border-radius:0 6px 6px 0;">
                                ${result.suggestions.map(s => `<div style="font-size:0.8em; color:#10B981; margin-bottom:2px;">💡 ${s}</div>`).join('')}
                            </div>
                        ` : '<div style="font-size:0.8em; color:#10B981;">✅ Fully optimized for ' + config.name + '</div>'}
                    </div>
                `;
            });

            // Auto-Fix button
            html += `
                <div style="text-align:center; margin-top:16px;">
                    <button onclick="autoFixPlatformIssues('${platform}')" class="action-button orange-button" style="padding:10px 24px; font-size:0.9em;">
                        <i class="fas fa-magic"></i> Auto-Fix All Issues (Trim Keywords & Titles)
                    </button>
                </div>
            `;

            resultsEl.innerHTML = html;

        } catch (error) {
            console.error("Platform optimization error:", error);
            resultsEl.innerHTML = `<div style="color:#EF4444; text-align:center; padding:20px;"><i class="fas fa-exclamation-triangle"></i> Error: ${error.message}</div>`;
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-bolt"></i> Analyze & Optimize';
        }
    };

    window.autoFixPlatformIssues = function (platform) {
        const config = CSV_FORMATS[platform];
        if (!config) return;

        let fixCount = 0;
        const successfulFiles = uploadedFilesData.filter(f => f.title && f.title !== "Error");

        successfulFiles.forEach(fileData => {
            // Fix title length
            if (fileData.title && fileData.title.length > config.maxTitleLen) {
                fileData.title = fileData.title.substring(0, config.maxTitleLen - 3) + '...';
                fixCount++;
            }

            // Fix keyword count
            if (fileData.keywords) {
                const kArr = fileData.keywords.split(',').map(k => k.trim()).filter(k => k);
                if (kArr.length > config.maxKeywords) {
                    fileData.keywords = kArr.slice(0, config.maxKeywords).join(', ');
                    fixCount++;
                }
            }

            // Update UI
            const card = document.getElementById(fileData.id);
            if (card) {
                const titleEl = card.querySelector('.meta-title');
                if (titleEl) titleEl.textContent = fileData.title;
                if (typeof updateKeywordsDisplay === 'function') updateKeywordsDisplay(fileData.id);
            }
        });

        if (typeof showCustomAlert === 'function') {
            showCustomAlert(`✅ Auto-fixed ${fixCount} issues for ${config.name}!`, 'success');
        } else {
            alert(`Auto-fixed ${fixCount} issues for ${config.name}!`);
        }

        // Re-run analysis
        runPlatformOptimization();
    };


    // ================================================================
    // SECTION 3: MARKET ANALYTICS DASHBOARD
    // ================================================================

    window.loadMarketAnalytics = async function () {
        const container = document.getElementById('marketAnalyticsContent');
        const btn = document.getElementById('loadMarketAnalyticsBtn');

        if (!container) return;

        const category = document.getElementById('analyticsCategory')?.value || 'Nature';
        const region = document.getElementById('analyticsRegion')?.value || 'Global';

        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing Market...';
        container.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);"><i class="fas fa-chart-bar fa-3x" style="opacity:0.3; margin-bottom:15px; display:block;"></i>Loading market data...</div>';

        try {
            const user = auth.currentUser;
            if (!user) {
                document.getElementById('loginModal').classList.remove('hidden');
                return;
            }

            const accessToken = await user.getIdToken();
            const proxyUrl = "https://metagen-pro-api.metagenp.workers.dev/generate";

            const prompt = `You are a stock photography market intelligence AI. Analyze the current market for "${category}" content in the "${region}" region.

Return ONLY valid JSON with this exact structure:
{
  "overview": {
    "demand_score": 85,
    "supply_level": "Medium",
    "growth_trend": "+12% monthly",
    "avg_price_range": "$0.50-$3.00",
    "total_monthly_searches": "150K-200K"
  },
  "top_keywords": [
    {"keyword": "example keyword", "volume": "High", "competition": "Low", "trend": "Rising", "score": 92},
    {"keyword": "example keyword 2", "volume": "Medium", "competition": "Medium", "trend": "Stable", "score": 78}
  ],
  "gap_opportunities": [
    {"niche": "example gap", "reason": "Low supply, growing demand", "potential_score": 95, "suggested_keywords": ["kw1", "kw2", "kw3"]},
    {"niche": "example gap 2", "reason": "Trending topic with few assets", "potential_score": 88, "suggested_keywords": ["kw1", "kw2"]}
  ],
  "content_suggestions": [
    {"type": "Photo", "idea": "Specific content idea", "estimated_demand": "High"},
    {"type": "Vector", "idea": "Another idea", "estimated_demand": "Medium"}
  ],
  "seasonal_forecast": [
    {"month": "Current", "trend": "Peak", "tip": "Upload now for maximum visibility"},
    {"month": "Next Month", "trend": "Stable", "tip": "Prepare holiday content"}
  ]
}

Provide 10 top_keywords, 5 gap_opportunities, 6 content_suggestions, and 3 seasonal_forecast items. Make data realistic for ${new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}.`;

            const response = await fetch(proxyUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${accessToken}`
                },
                body: JSON.stringify({
                    action: "marketAnalytics",
                    prompt: prompt,
                    email: user.email,
                    deviceInfo: navigator.userAgent
                })
            });

            const data = await response.json();
            if (!response.ok) {
                if (response.status === 429) {
                    if (typeof showLimitModal === 'function') showLimitModal(data.error);
                    throw new Error("Daily limit reached");
                }
                throw new Error(data.error || "Analytics API Error");
            }

            let jsonString = data.text || data.metadata || JSON.stringify(data);
            jsonString = jsonString.replace(/```json\s*|```/gi, '').trim();
            const startObj = jsonString.indexOf('{');
            const endObj = jsonString.lastIndexOf('}');
            if (startObj !== -1 && endObj !== -1) {
                jsonString = jsonString.substring(startObj, endObj + 1);
            }
            jsonString = jsonString.replace(/[\x00-\x1F\x7F-\x9F]/g, " ");

            let analytics;
            try {
                analytics = JSON.parse(jsonString);
            } catch (e) {
                jsonString = jsonString.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
                analytics = JSON.parse(jsonString);
            }

            renderMarketAnalytics(analytics, category, region);

        } catch (error) {
            console.error("Market Analytics Error:", error);
            container.innerHTML = `<div style="color:#EF4444; text-align:center; padding:30px;"><i class="fas fa-exclamation-triangle"></i> ${error.message}<br><small style="color:var(--text-muted);">Try again or switch category.</small></div>`;
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-chart-bar"></i> Analyze Market';
        }
    };

    function renderMarketAnalytics(data, category, region) {
        const container = document.getElementById('marketAnalyticsContent');
        const ov = data.overview || {};
        const demandColor = (ov.demand_score || 0) >= 75 ? '#10B981' : (ov.demand_score || 0) >= 50 ? '#F59E0B' : '#EF4444';

        let html = `
            <!-- Overview Cards -->
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap:12px; margin-bottom:24px;">
                <div style="background:linear-gradient(135deg, rgba(16,185,129,0.1), rgba(16,185,129,0.02)); border:1px solid rgba(16,185,129,0.2); border-radius:12px; padding:16px; text-align:center;">
                    <div style="font-size:2.2em; font-weight:800; color:${demandColor};">${ov.demand_score || 75}</div>
                    <div style="font-size:0.75em; color:var(--text-muted); font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">Demand Score</div>
                </div>
                <div style="background:linear-gradient(135deg, rgba(59,130,246,0.1), rgba(59,130,246,0.02)); border:1px solid rgba(59,130,246,0.2); border-radius:12px; padding:16px; text-align:center;">
                    <div style="font-size:1.5em; font-weight:800; color:#3B82F6;">${ov.supply_level || 'Medium'}</div>
                    <div style="font-size:0.75em; color:var(--text-muted); font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">Supply Level</div>
                </div>
                <div style="background:linear-gradient(135deg, rgba(249,115,22,0.1), rgba(249,115,22,0.02)); border:1px solid rgba(249,115,22,0.2); border-radius:12px; padding:16px; text-align:center;">
                    <div style="font-size:1.5em; font-weight:800; color:#F97316;">${ov.growth_trend || '+5%'}</div>
                    <div style="font-size:0.75em; color:var(--text-muted); font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">Growth</div>
                </div>
                <div style="background:linear-gradient(135deg, rgba(139,92,246,0.1), rgba(139,92,246,0.02)); border:1px solid rgba(139,92,246,0.2); border-radius:12px; padding:16px; text-align:center;">
                    <div style="font-size:1.2em; font-weight:800; color:#8B5CF6;">${ov.total_monthly_searches || '100K'}</div>
                    <div style="font-size:0.75em; color:var(--text-muted); font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">Monthly Searches</div>
                </div>
            </div>

            <!-- Top Keywords Table -->
            <div style="background:var(--bg-input); border:1px solid var(--border-color); border-radius:12px; padding:16px; margin-bottom:20px;">
                <h3 style="margin:0 0 12px; font-size:1em; color:var(--text-primary); display:flex; align-items:center; gap:8px;">
                    <i class="fas fa-key" style="color:#F97316;"></i> Top Keywords — ${category}
                    <button onclick="copyAnalyticsKeywords()" style="margin-left:auto; background:rgba(59,130,246,0.1); border:1px solid #3B82F6; color:#3B82F6; padding:4px 10px; border-radius:6px; font-size:0.8em; cursor:pointer;">
                        <i class="fas fa-copy"></i> Copy All
                    </button>
                </h3>
                <div style="overflow-x:auto;">
                    <table style="width:100%; border-collapse:collapse; font-size:0.85em;">
                        <thead>
                            <tr style="border-bottom:2px solid var(--border-color);">
                                <th style="text-align:left; padding:8px; color:var(--text-muted); font-size:0.85em;">Keyword</th>
                                <th style="text-align:center; padding:8px; color:var(--text-muted); font-size:0.85em;">Volume</th>
                                <th style="text-align:center; padding:8px; color:var(--text-muted); font-size:0.85em;">Competition</th>
                                <th style="text-align:center; padding:8px; color:var(--text-muted); font-size:0.85em;">Trend</th>
                                <th style="text-align:center; padding:8px; color:var(--text-muted); font-size:0.85em;">Score</th>
                            </tr>
                        </thead>
                        <tbody id="analyticsKeywordsTable">
                            ${(data.top_keywords || []).map(kw => {
                                const volColor = (kw.volume || '').toLowerCase() === 'high' ? '#10B981' : ((kw.volume || '').toLowerCase() === 'low' ? '#EF4444' : '#F59E0B');
                                const compColor = (kw.competition || '').toLowerCase() === 'low' ? '#10B981' : ((kw.competition || '').toLowerCase() === 'high' ? '#EF4444' : '#F59E0B');
                                const trendIcon = (kw.trend || '').toLowerCase().includes('ris') ? '📈' : ((kw.trend || '').toLowerCase().includes('fall') ? '📉' : '📊');
                                return `<tr style="border-bottom:1px solid var(--border-light);">
                                    <td style="padding:8px; color:var(--text-primary); font-weight:600;">${kw.keyword || ''}</td>
                                    <td style="text-align:center; padding:8px;"><span style="color:${volColor}; font-weight:600;">${kw.volume || 'Medium'}</span></td>
                                    <td style="text-align:center; padding:8px;"><span style="color:${compColor}; font-weight:600;">${kw.competition || 'Medium'}</span></td>
                                    <td style="text-align:center; padding:8px;">${trendIcon} ${kw.trend || 'Stable'}</td>
                                    <td style="text-align:center; padding:8px;"><b style="color:${(kw.score || 0) >= 80 ? '#10B981' : '#F59E0B'};">${kw.score || 0}</b></td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Gap Opportunities -->
            <div style="margin-bottom:20px;">
                <h3 style="margin:0 0 12px; font-size:1em; color:var(--text-primary); display:flex; align-items:center; gap:8px;">
                    <i class="fas fa-gem" style="color:#8B5CF6;"></i> 🎯 Gap Opportunities (Low Supply, High Demand)
                </h3>
                <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:12px;">
                    ${(data.gap_opportunities || []).map(gap => `
                        <div style="background:var(--bg-input); border:1px solid var(--border-color); border-radius:10px; padding:14px; border-left:4px solid #8B5CF6;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                                <span style="font-weight:700; color:var(--text-primary); font-size:0.9em;">${gap.niche || 'Opportunity'}</span>
                                <span style="background:rgba(139,92,246,0.15); color:#8B5CF6; padding:3px 10px; border-radius:12px; font-size:0.75em; font-weight:700;">${gap.potential_score || 85}% Potential</span>
                            </div>
                            <p style="font-size:0.82em; color:var(--text-muted); margin:0 0 8px;">${gap.reason || ''}</p>
                            <div style="display:flex; flex-wrap:wrap; gap:4px;">
                                ${(gap.suggested_keywords || []).map(k => `<span style="background:rgba(139,92,246,0.08); color:#8B5CF6; padding:2px 8px; border-radius:4px; font-size:0.7em; border:1px solid rgba(139,92,246,0.2);">${k}</span>`).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>

            <!-- Content Suggestions -->
            <div style="background:var(--bg-input); border:1px solid var(--border-color); border-radius:12px; padding:16px; margin-bottom:20px;">
                <h3 style="margin:0 0 12px; font-size:1em; color:var(--text-primary);">
                    <i class="fas fa-lightbulb" style="color:#EAB308;"></i> What to Create Now
                </h3>
                <div style="display:grid; gap:8px;">
                    ${(data.content_suggestions || []).map(cs => {
                        const typeColor = cs.type === 'Photo' ? '#3B82F6' : cs.type === 'Vector' ? '#10B981' : '#8B5CF6';
                        const demandColor2 = (cs.estimated_demand || '').toLowerCase() === 'high' ? '#10B981' : '#F59E0B';
                        return `
                        <div style="display:flex; align-items:center; gap:12px; padding:10px; background:rgba(0,0,0,0.05); border-radius:8px;">
                            <span style="background:${typeColor}20; color:${typeColor}; padding:4px 10px; border-radius:6px; font-size:0.75em; font-weight:700; min-width:60px; text-align:center;">${cs.type || 'Photo'}</span>
                            <span style="flex:1; font-size:0.85em; color:var(--text-primary);">${cs.idea || ''}</span>
                            <span style="color:${demandColor2}; font-size:0.75em; font-weight:700;">${cs.estimated_demand || 'Medium'}</span>
                        </div>`;
                    }).join('')}
                </div>
            </div>

            <!-- Seasonal Forecast -->
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:12px;">
                ${(data.seasonal_forecast || []).map(sf => `
                    <div style="background:var(--bg-input); border:1px solid var(--border-color); border-radius:10px; padding:14px; text-align:center;">
                        <div style="font-size:0.8em; color:var(--accent-orange); font-weight:700; text-transform:uppercase; margin-bottom:6px;">${sf.month || ''}</div>
                        <div style="font-size:1.5em; margin-bottom:4px;">${sf.trend === 'Peak' ? '🔥' : sf.trend === 'Stable' ? '📊' : '📉'}</div>
                        <div style="font-size:0.8em; color:var(--text-primary); font-weight:600; margin-bottom:6px;">${sf.trend || 'Stable'}</div>
                        <div style="font-size:0.75em; color:var(--text-muted);">${sf.tip || ''}</div>
                    </div>
                `).join('')}
            </div>
        `;

        container.innerHTML = html;

        // Store keywords for copy function
        window._analyticsKeywords = (data.top_keywords || []).map(k => k.keyword).join(', ');
    }

    window.copyAnalyticsKeywords = function () {
        if (window._analyticsKeywords) {
            navigator.clipboard.writeText(window._analyticsKeywords).then(() => {
                if (typeof showCustomAlert === 'function') showCustomAlert("Keywords copied to clipboard!", "success");
                else alert("Keywords copied!");
            });
        }
    };


    // ================================================================
    // SECTION 4: AI CONTENT IDEAS GENERATOR
    // ================================================================

    window.generateContentIdeas = async function () {
        const container = document.getElementById('contentIdeasResults');
        const btn = document.getElementById('generateContentIdeasBtn');
        const niche = document.getElementById('contentIdeasNiche')?.value || 'Business';
        const contentType = document.getElementById('contentIdeasType')?.value || 'Photos';
        const difficulty = document.getElementById('contentIdeasDifficulty')?.value || 'Intermediate';

        if (!container || !btn) return;

        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating Ideas...';
        container.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);"><i class="fas fa-spinner fa-spin fa-2x"></i><br><br>AI is generating profitable content ideas...</div>';

        try {
            const user = auth.currentUser;
            if (!user) {
                document.getElementById('loginModal').classList.remove('hidden');
                return;
            }

            const accessToken = await user.getIdToken();
            const monthInfo = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });

            const prompt = `You are a stock photography business strategist. Generate 10 highly specific, profitable content creation ideas for "${niche}" category, focusing on "${contentType}" type content, suitable for "${difficulty}" level creators, optimized for ${monthInfo}.

Return ONLY valid JSON:
{
  "ideas": [
    {
      "title": "Specific shoot/creation idea title",
      "description": "Detailed 2-3 sentence description of what to create",
      "estimated_earnings": "$5-$50/month",
      "difficulty": "Easy/Medium/Hard",
      "time_to_create": "30 mins",
      "target_platforms": ["Adobe Stock", "Shutterstock"],
      "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
      "pro_tip": "A professional tip to make this content stand out",
      "demand_level": "🔥 Very High",
      "seasonal": true,
      "category": "Sub-category name"
    }
  ],
  "weekly_plan": {
    "monday": "What to shoot/create",
    "tuesday": "What to shoot/create",
    "wednesday": "What to shoot/create",
    "thursday": "What to shoot/create",
    "friday": "What to shoot/create",
    "saturday": "Edit & keyword optimization",
    "sunday": "Upload & portfolio review"
  },
  "quick_wins": [
    "A quick tip to increase sales immediately",
    "Another quick actionable tip",
    "Third quick tip"
  ]
}`;

            const response = await fetch("https://metagen-pro-api.metagenp.workers.dev/generate", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${accessToken}`
                },
                body: JSON.stringify({
                    action: "contentIdeas",
                    prompt: prompt,
                    email: user.email,
                    deviceInfo: navigator.userAgent
                })
            });

            const data = await response.json();
            if (!response.ok) {
                if (response.status === 429) {
                    if (typeof showLimitModal === 'function') showLimitModal(data.error);
                    throw new Error("Daily limit reached");
                }
                throw new Error(data.error || "Content Ideas API Error");
            }

            let jsonString = data.text || data.metadata || JSON.stringify(data);
            jsonString = jsonString.replace(/```json\s*|```/gi, '').trim();
            const startObj = jsonString.indexOf('{');
            const endObj = jsonString.lastIndexOf('}');
            if (startObj !== -1 && endObj !== -1) {
                jsonString = jsonString.substring(startObj, endObj + 1);
            }
            jsonString = jsonString.replace(/[\x00-\x1F\x7F-\x9F]/g, " ");

            let ideas;
            try {
                ideas = JSON.parse(jsonString);
            } catch (e) {
                jsonString = jsonString.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
                ideas = JSON.parse(jsonString);
            }

            renderContentIdeas(ideas, niche, contentType);

        } catch (error) {
            console.error("Content Ideas Error:", error);
            container.innerHTML = `<div style="color:#EF4444; text-align:center; padding:30px;"><i class="fas fa-exclamation-triangle"></i> ${error.message}</div>`;
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-lightbulb"></i> Generate Ideas';
        }
    };

    function renderContentIdeas(data, niche, contentType) {
        const container = document.getElementById('contentIdeasResults');
        const ideasList = data.ideas || [];
        const weeklyPlan = data.weekly_plan || {};
        const quickWins = data.quick_wins || [];

        let html = '';

        // Quick Wins Banner
        if (quickWins.length > 0) {
            html += `
                <div style="background:linear-gradient(135deg, rgba(249,115,22,0.1), rgba(249,115,22,0.02)); border:1px solid rgba(249,115,22,0.3); border-radius:12px; padding:16px; margin-bottom:20px;">
                    <h3 style="margin:0 0 10px; font-size:0.95em; color:#F97316;"><i class="fas fa-bolt"></i> Quick Wins — Do These Today!</h3>
                    ${quickWins.map(tip => `<div style="font-size:0.85em; color:var(--text-primary); padding:4px 0; display:flex; align-items:flex-start; gap:6px;"><span style="color:#F97316;">⚡</span> ${tip}</div>`).join('')}
                </div>
            `;
        }

        // Weekly Plan
        if (Object.keys(weeklyPlan).length > 0) {
            const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
            const dayEmoji = ['📸', '🎨', '📸', '🎨', '📸', '✏️', '📤'];
            html += `
                <div style="background:var(--bg-input); border:1px solid var(--border-color); border-radius:12px; padding:16px; margin-bottom:20px;">
                    <h3 style="margin:0 0 12px; font-size:0.95em; color:var(--text-primary);"><i class="fas fa-calendar-week" style="color:#3B82F6;"></i> Your Weekly Content Plan</h3>
                    <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap:8px;">
                        ${days.map((day, i) => `
                            <div style="background:rgba(59,130,246,0.05); border:1px solid var(--border-light); border-radius:8px; padding:10px; text-align:center;">
                                <div style="font-size:1.2em; margin-bottom:4px;">${dayEmoji[i]}</div>
                                <div style="font-size:0.7em; color:var(--accent-blue); font-weight:700; text-transform:uppercase; margin-bottom:4px;">${day.charAt(0).toUpperCase() + day.slice(1)}</div>
                                <div style="font-size:0.75em; color:var(--text-primary); line-height:1.3;">${weeklyPlan[day] || '-'}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // Content Ideas Grid
        html += `<h3 style="margin:0 0 14px; font-size:1em; color:var(--text-primary);"><i class="fas fa-lightbulb" style="color:#EAB308;"></i> ${ideasList.length} Content Ideas for "${niche}" — ${contentType}</h3>`;

        html += `<div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap:14px;">`;

        ideasList.forEach((idea, index) => {
            const diffColor = idea.difficulty === 'Easy' ? '#10B981' : idea.difficulty === 'Hard' ? '#EF4444' : '#F59E0B';
            const keywords = idea.keywords || [];

            html += `
                <div style="background:var(--bg-input); border:1px solid var(--border-color); border-radius:12px; padding:16px; display:flex; flex-direction:column; gap:10px; transition:transform 0.2s, box-shadow 0.2s;" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 8px 20px rgba(0,0,0,0.15)';" onmouseout="this.style.transform=''; this.style.boxShadow='';">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                        <span style="background:rgba(249,115,22,0.1); color:#F97316; padding:3px 8px; border-radius:6px; font-size:0.7em; font-weight:700;">#${index + 1}</span>
                        <span style="font-size:0.85em; font-weight:700;">${idea.demand_level || '📊 Medium'}</span>
                    </div>
                    <h4 style="margin:0; font-size:0.95em; color:var(--text-primary); line-height:1.3;">${idea.title || 'Content Idea'}</h4>
                    <p style="margin:0; font-size:0.82em; color:var(--text-muted); line-height:1.4;">${idea.description || ''}</p>
                    
                    <div style="display:flex; flex-wrap:wrap; gap:8px; font-size:0.75em;">
                        <span style="color:${diffColor}; font-weight:600;">⚡ ${idea.difficulty || 'Medium'}</span>
                        <span style="color:var(--text-muted);">⏱ ${idea.time_to_create || '1 hour'}</span>
                        <span style="color:#10B981; font-weight:600;">💰 ${idea.estimated_earnings || '$5-20/mo'}</span>
                    </div>

                    ${idea.pro_tip ? `
                    <div style="background:rgba(16,185,129,0.05); border-left:3px solid #10B981; padding:8px 10px; border-radius:0 6px 6px 0;">
                        <span style="font-size:0.75em; color:#10B981; font-weight:700;">💡 PRO TIP:</span>
                        <span style="font-size:0.78em; color:var(--text-primary);"> ${idea.pro_tip}</span>
                    </div>
                    ` : ''}

                    <div style="display:flex; flex-wrap:wrap; gap:4px;">
                        ${keywords.slice(0, 7).map(k => `<span style="background:var(--bg-tertiary); color:var(--text-primary); padding:2px 7px; border-radius:4px; font-size:0.7em; border:1px solid var(--border-light);">${k}</span>`).join('')}
                    </div>

                    <div style="display:flex; gap:6px; margin-top:auto;">
                        <button onclick="copyIdeaKeywords('${keywords.join(', ').replace(/'/g, "\\'")}')" style="flex:1; background:rgba(59,130,246,0.1); border:1px solid #3B82F6; color:#3B82F6; padding:6px; border-radius:6px; font-size:0.75em; cursor:pointer;">
                            <i class="fas fa-copy"></i> Copy Tags
                        </button>
                        <button onclick="copyIdeaFull('${(idea.title || '').replace(/'/g, "\\'")}', '${(idea.description || '').replace(/'/g, "\\'")}', '${keywords.join(', ').replace(/'/g, "\\'")}')" style="flex:1; background:rgba(249,115,22,0.1); border:1px solid #F97316; color:#F97316; padding:6px; border-radius:6px; font-size:0.75em; cursor:pointer;">
                            <i class="fas fa-clipboard"></i> Copy All
                        </button>
                    </div>

                    ${(idea.target_platforms || []).length > 0 ? `
                    <div style="display:flex; flex-wrap:wrap; gap:4px;">
                        ${idea.target_platforms.map(p => `<span style="background:rgba(59,130,246,0.08); color:#3B82F6; padding:2px 6px; border-radius:8px; font-size:0.65em; font-weight:600;">${p}</span>`).join('')}
                    </div>
                    ` : ''}
                </div>
            `;
        });

        html += `</div>`;

        container.innerHTML = html;
    }

    window.copyIdeaKeywords = function (keywords) {
        navigator.clipboard.writeText(keywords).then(() => {
            if (typeof showCustomAlert === 'function') showCustomAlert("Keywords copied!", "success");
            else alert("Keywords copied!");
        });
    };

    window.copyIdeaFull = function (title, desc, keywords) {
        const text = `Title: ${title}\nDescription: ${desc}\nKeywords: ${keywords}`;
        navigator.clipboard.writeText(text).then(() => {
            if (typeof showCustomAlert === 'function') showCustomAlert("Full idea copied!", "success");
            else alert("Full idea copied!");
        });
    };

});
