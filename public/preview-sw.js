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
    if (url.pathname.startsWith('/preview/')) {
        // Decode URI components to handle spaces and special characters
        const relativePath = decodeURIComponent(url.pathname.replace('/preview/', ''));
        const cleanPath = relativePath || 'index.html';

        console.log('[SW] Fetching:', cleanPath);

        if (files.has(cleanPath)) {
            const content = files.get(cleanPath);
            const lowerPath = cleanPath.toLowerCase();
            let contentType = 'text/plain';

            if (lowerPath.endsWith('.html')) contentType = 'text/html';
            else if (lowerPath.endsWith('.css')) contentType = 'text/css';
            else if (lowerPath.endsWith('.js')) contentType = 'application/javascript';
            else if (lowerPath.endsWith('.png')) contentType = 'image/png';
            else if (lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) contentType = 'image/jpeg';
            else if (lowerPath.endsWith('.svg')) contentType = 'image/svg+xml';
            else if (lowerPath.endsWith('.gif')) contentType = 'image/gif';
            else if (lowerPath.endsWith('.webp')) contentType = 'image/webp';
            else if (lowerPath.endsWith('.ico')) contentType = 'image/x-icon';
            else if (lowerPath.endsWith('.json')) contentType = 'application/json';
            else if (lowerPath.endsWith('.xml')) contentType = 'application/xml';
            else if (lowerPath.endsWith('.txt')) contentType = 'text/plain';

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
                        <img src="/error.png" alt="Could not connect to file" />
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
