const files = new Map();

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

self.addEventListener('message', (event) => {
    if (event.data.type === 'SET_FILES') {
        files.clear();
        for (const [path, content] of Object.entries(event.data.files)) {
            files.set(path, content);
        }
        console.log('[SW] Files updated', files.size);
        // Send acknowledgement
        if (event.source) {
            event.source.postMessage({ type: 'FILES_SET_ACK' });
        }
    }
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Only intercept requests to our virtual preview path
    if (url.pathname.includes('/preview/')) {
        // Decode URI components to handle spaces and special characters
        // Extract everything after '/preview/'
        const matchIndex = url.pathname.indexOf('/preview/');
        const relativePath = decodeURIComponent(url.pathname.substring(matchIndex + 9)); // 9 is length of '/preview/'
        const cleanPath = relativePath || 'index.html';

        console.log('[SW] Fetching:', cleanPath);

        if (files.has(cleanPath)) {
            const content = files.get(cleanPath);
            const lowerPath = cleanPath.toLowerCase();
            let contentType = 'text/plain';

            if (lowerPath.endsWith('.html')) {
                contentType = 'text/html';
                event.respondWith(new Response(content, { headers: { 'Content-Type': contentType } }));
                return;
            }

            if (lowerPath.endsWith('.css')) contentType = 'text/css';
            else if (lowerPath.endsWith('.js')) contentType = 'application/javascript';
            else if (lowerPath.endsWith('.png')) contentType = 'image/png';
            else if (lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) contentType = 'image/jpeg';
            else if (lowerPath.endsWith('.svg')) contentType = 'image/svg+xml';
            else if (lowerPath.endsWith('.gif')) contentType = 'image/gif';
            else if (lowerPath.endsWith('.webp')) contentType = 'image/webp';
            else if (lowerPath.endsWith('.ico')) contentType = 'image/x-icon';
            else if (lowerPath.endsWith('.json')) {
                // If it's a JSON file being previewed directly, make it pretty
                if (url.searchParams.has('t')) { // Usually active preview has timestamp
                    const prettyJson = `
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <meta charset="UTF-8">
                            <title>JSON Preview</title>
                            <style>
                                body { background: #0f172a; color: #e2e8f0; font-family: 'Fira Code', monospace; padding: 2rem; }
                                pre { background: #1e293b; padding: 1.5rem; border-radius: 12px; border: 1px solid #334155; overflow: auto; line-height: 1.5; }
                                .key { color: #818cf8; }
                                .string { color: #34d399; }
                                .number { color: #fbbf24; }
                                .boolean { color: #f472b6; }
                                .null { color: #94a3b8; }
                            </style>
                        </head>
                        <body>
                            <h2>JSON Data</h2>
                            <pre id="json-output"></pre>
                            <script>
                                const data = ${typeof content === 'string' ? content : JSON.stringify(content)};
                                function syntaxHighlight(json) {
                                    if (typeof json != 'string') {
                                        json = JSON.stringify(json, undefined, 4);
                                    }
                                    json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                                    return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\"|[^"])*"(\\s*:)?|\\b(true|false|null)\\b|-?\\d+(?:\\.\\d*)?(?:[eE][+\\-]?\\d+)?)/g, function (match) {
                                        var cls = 'number';
                                        if (/^"/.test(match)) {
                                            if (/:$/.test(match)) {
                                                cls = 'key';
                                            } else {
                                                cls = 'string';
                                            }
                                        } else if (/true|false/.test(match)) {
                                            cls = 'boolean';
                                        } else if (/null/.test(match)) {
                                            cls = 'null';
                                        }
                                        return '<span class="' + cls + '">' + match + '</span>';
                                    });
                                }
                                try {
                                    document.getElementById('json-output').innerHTML = syntaxHighlight(data);
                                } catch (e) {
                                    document.getElementById('json-output').textContent = JSON.stringify(data, null, 4);
                                }
                            </script>
                        </body>
                        </html>
                    `;
                    event.respondWith(new Response(prettyJson, { headers: { 'Content-Type': 'text/html' } }));
                    return;
                }
                contentType = 'application/json';
            }
            else if (lowerPath.endsWith('.jsx') || lowerPath.endsWith('.tsx')) {
                // Return a template that renders React
                const reactHtml = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <title>React Preview</title>
                        <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
                        <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
                        <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
                        <style>
                            body { background: #0f172a; color: white; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                            #root { width: 100%; height: 100%; }
                        </style>
                    </head>
                    <body>
                        <div id="root"></div>
                        <script type="text/babel">
                            ${content}
                            
                            // Attempt to render if there's an App or if we can find something to render
                            if (typeof App !== 'undefined') {
                                const root = ReactDOM.createRoot(document.getElementById('root'));
                                root.render(<App />);
                            } else {
                                // If no App, try to find a component or just notify
                                console.log("React file loaded. Define an 'App' component to see it rendered.");
                            }
                        </script>
                    </body>
                    </html>
                `;
                event.respondWith(new Response(reactHtml, { headers: { 'Content-Type': 'text/html' } }));
                return;
            }
            else if (lowerPath.endsWith('.xml')) contentType = 'application/xml';
            else if (lowerPath.endsWith('.txt')) contentType = 'text/plain';

            // Catch-all for other languages to show them in a code viewer if previewed directly
            const codeExtensions = ['.py', '.java', '.cpp', '.h', '.hpp', '.cc', '.sql', '.rs', '.go', '.php', '.cs', '.kt', '.swift', '.ts'];
            if (codeExtensions.some(ext => lowerPath.endsWith(ext)) && url.searchParams.has('t')) {
                const codeHtml = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <title>Code Preview</title>
                        <style>
                            body { background: #0f172a; color: #e2e8f0; font-family: 'Fira Code', monospace; padding: 2rem; }
                            pre { background: #1e293b; padding: 1.5rem; border-radius: 12px; border: 1px solid #334155; overflow: auto; line-height: 1.5; white-space: pre-wrap; }
                            .header { margin-bottom: 1rem; display: flex; align-items: center; gap: 10px; }
                            .badge { background: #3b82f6; color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: bold; }
                        </style>
                    </head>
                    <body>
                        <div class="header">
                            <span class="badge">${lowerPath.split('.').pop().toUpperCase()}</span>
                            <span>${cleanPath}</span>
                        </div>
                        <pre><code>${content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
                    </body>
                    </html>
                `;
                event.respondWith(new Response(codeHtml, { headers: { 'Content-Type': 'text/html' } }));
                return;
            }

            event.respondWith(new Response(content, {
                headers: { 'Content-Type': contentType }
            }));
        } else {
            // Fallback or 404 - Show funny connection error image
            const errorHtml = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <title>Could Not Connect</title>
                    <style>
                        body { 
                            background: #0f172a; 
                            display: flex; 
                            align-items: center; 
                            justify-content: center; 
                            height: 100vh; 
                            margin: 0; 
                            color: white; 
                            font-family: 'Inter', -apple-system, sans-serif;
                            overflow: hidden;
                        }
                        .error-container { 
                            text-align: center; 
                            max-width: 500px; 
                            padding: 20px;
                            animation: fadeIn 0.8s ease-out;
                        }
                        img { 
                            width: 100%; 
                            max-width: 400px; 
                            border-radius: 24px; 
                            box-shadow: 0 20px 50px rgba(19, 108, 255, 0.3);
                            margin-bottom: 20px;
                        }
                        h2 { margin: 0; font-size: 1.5rem; opacity: 0.9; }
                        @keyframes fadeIn {
                            from { opacity: 0; transform: translateY(20px); }
                            to { opacity: 1; transform: translateY(0); }
                        }
                    </style>
                </head>
                <body>
                    <div class="error-container">
                        <script>
                            const swPath = "${self.location.pathname}";
                            const appScope = swPath.substring(0, swPath.lastIndexOf('/'));
                            document.write('<img src="' + appScope + '/error.png" alt="Could not connect to file" />');
                        </script>
                        <noscript>
                             <img src="./error.png" alt="Could not connect to file" />
                        </noscript>
                        <h2>Oops! Could not find "${cleanPath}"</h2>
                    </div>
                </body>
                </html>
            `;
            event.respondWith(new Response(errorHtml, {
                status: 200,
                headers: { 'Content-Type': 'text/html' }
            }));
        }
    }
});

