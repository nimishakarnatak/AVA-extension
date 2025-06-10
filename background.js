let isRecording = false;
let interactionLog = [];
let currentTabId = null;

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    switch(request.action) {
        case 'getStatus':
            chrome.storage.local.get(['recordedVideo'], function(result) {
                sendResponse({
                    isRecording: isRecording,
                    hasRecording: !!result.recordedVideo
                });
            });
            return true;
            
        case 'startRecording':
            startRecordingViaContentScript(request.trackInteractions)
                .then(() => {
                    sendResponse({success: true});
                })
                .catch(error => {
                    console.error('Recording failed:', error);
                    sendResponse({success: false, error: error.message, errorType: error.type});
                });
            return true;
            
        case 'stopRecording':
            stopRecordingViaContentScript()
                .then(() => {
                    sendResponse({success: true});
                })
                .catch(error => {
                    console.error('Stop recording failed:', error);
                    sendResponse({success: false, error: error.message});
                });
            return true;
            
        case 'recordingStarted':
            isRecording = true;
            currentTabId = sender.tab?.id;
            
            // Notify popup that recording has started
            chrome.runtime.sendMessage({
                action: 'recordingStatusChanged',
                isRecording: true
            }).catch(() => {
                // Popup might not be open, that's ok
            });
            
            sendResponse({success: true});
            break;
            
        case 'recordingStopped':
            isRecording = false;
            currentTabId = null;
            
            console.log('Recording stopped, processing for download...');
            
            // Immediately process and download the recording
            if (request.videoBlob && request.interactionLog) {
                processAndDownloadRecording(request.videoBlob, request.interactionLog)
                    .then(() => {
                        console.log('Download processing completed successfully');
                    })
                    .catch(error => {
                        console.error('Download processing failed:', error);
                    });
            } else {
                console.warn('Missing video blob or interaction log');
            }
            
            // Notify popup that recording has stopped
            chrome.runtime.sendMessage({
                action: 'recordingStatusChanged',
                isRecording: false,
                hasRecording: false // No need to store since we're downloading immediately
            }).catch(() => {
                // Popup might not be open, that's ok
            });
            
            sendResponse({success: true});
            break;
            
        case 'downloadRecording':
            // This is now handled automatically, but kept for compatibility
            console.log('Manual download requested - files should already be downloaded');
            sendResponse({success: true});
            break;
            
        case 'recordingError':
            isRecording = false;
            currentTabId = null;
            
            console.error('Recording error received:', request.error);
            
            // Notify popup about the error
            chrome.runtime.sendMessage({
                action: 'recordingStatusChanged',
                isRecording: false,
                hasRecording: false,
                error: request.error,
                errorType: request.errorType
            }).catch(() => {
                // Popup might not be open, that's ok
            });
            
            sendResponse({success: false, error: request.error, errorType: request.errorType});
            break;
        case 'logInteraction':
            if (isRecording && request.data) {
                interactionLog.push({
                    timestamp: Date.now(),
                    type: request.data.type,
                    x: request.data.x,
                    y: request.data.y,
                    target: request.data.target,
                    url: sender.tab?.url
                });
            }
            break;
    }
});

async function startRecordingViaContentScript(trackInteractions) {
    try {
        // Get current active tab
        const tabs = await new Promise((resolve) => {
            chrome.tabs.query({active: true, currentWindow: true}, resolve);
        });
        
        if (!tabs || tabs.length === 0) {
            const error = new Error('No active tab found. Please make sure you have a Chrome tab open and try again.');
            error.type = 'no_tab';
            throw error;
        }
        
        const currentTab = tabs[0];
        currentTabId = currentTab.id;
        
        // Inject recording script into the current tab
        await chrome.scripting.executeScript({
            target: { tabId: currentTab.id },
            func: initializeRecording,
            args: [trackInteractions]
        });
        
    } catch (error) {
        console.error('Failed to start recording:', error);
        
        if (error.type) {
            throw error;
        } else if (error.message.includes('Cannot access')) {
            const newError = new Error('Cannot record on this page. Please try on a regular webpage (not chrome:// or extension pages).');
            newError.type = 'restricted_page';
            throw newError;
        } else {
            const newError = new Error('Failed to initialize recording. ' + error.message);
            newError.type = 'initialization_error';
            throw newError;
        }
    }
}

async function stopRecordingViaContentScript() {
    try {
        if (!currentTabId) {
            throw new Error('No active recording found');
        }
        
        // Execute stop recording in the tab
        await chrome.scripting.executeScript({
            target: { tabId: currentTabId },
            func: stopRecording
        });
        
    } catch (error) {
        console.error('Failed to stop recording:', error);
        throw error;
    }
}

// Function to be injected into the page
function initializeRecording(trackInteractions) {
    // Avoid multiple initializations
    if (window.screenRecorderInitialized) {
        return;
    }
    window.screenRecorderInitialized = true;
    
    let mediaRecorder = null;
    let recordedChunks = [];
    let isRecording = false;
    let isTracking = false;
    let trackingIndicator = null;
    let localInteractionLog = [];
    
    // Start the recording
    startRecording(trackInteractions);
    
    async function startRecording(enableTracking) {
        try {
            console.log('Starting screen recording...');
            
            // Request screen capture using the modern API
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    mediaSource: 'screen',
                    width: { ideal: 1920, max: 1920 },
                    height: { ideal: 1080, max: 1080 },
                    frameRate: { ideal: 30, max: 60 }
                },
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    sampleRate: 44100
                }
            });
            
            console.log('Screen capture stream obtained');
            
            // Setup MediaRecorder with MP4-compatible settings
            recordedChunks = [];
            localInteractionLog = [];
            
            // Try H.264 first for MP4 compatibility, fallback to WebM
            let mimeType = 'video/mp4;codecs=h264,aac';
            if (!MediaRecorder.isTypeSupported(mimeType)) {
                mimeType = 'video/webm;codecs=vp9,opus';
                if (!MediaRecorder.isTypeSupported(mimeType)) {
                    mimeType = 'video/webm;codecs=vp8,opus';
                    if (!MediaRecorder.isTypeSupported(mimeType)) {
                        mimeType = 'video/webm';
                    }
                }
            }
            
            console.log('Using MIME type:', mimeType);
            
            mediaRecorder = new MediaRecorder(stream, {
                mimeType: mimeType,
                videoBitsPerSecond: 2500000, // 2.5 Mbps
                audioBitsPerSecond: 128000   // 128 kbps
            });
            
            mediaRecorder.ondataavailable = function(event) {
                if (event.data && event.data.size > 0) {
                    recordedChunks.push(event.data);
                    console.log('Recorded chunk:', event.data.size, 'bytes');
                }
            };
            
            mediaRecorder.onerror = function(event) {
                console.error('MediaRecorder error:', event.error);
            };
            
            mediaRecorder.onstop = function() {
                console.log('MediaRecorder stopped, processing video...');
                processRecording();
            };
            
            // Start recording
            mediaRecorder.start(1000); // Collect data every second
            isRecording = true;
            
            console.log('MediaRecorder started successfully');
            
            // Notify background script
            chrome.runtime.sendMessage({
                action: 'recordingStarted'
            });
            
            // Start interaction tracking if requested
            if (enableTracking) {
                startInteractionTracking();
            }
            
            // Handle stream end (user stops sharing)
            stream.getVideoTracks()[0].addEventListener('ended', () => {
                console.log('Screen sharing ended by user');
                if (isRecording) {
                    stopRecording();
                }
            });
            
        } catch (error) {
            console.error('Failed to start recording:', error);
            
            let errorMessage;
            let errorType;
            
            if (error.name === 'NotAllowedError') {
                errorMessage = 'Screen recording permission was denied. Please allow screen sharing and try again.';
                errorType = 'permission_denied';
            } else if (error.name === 'NotFoundError') {
                errorMessage = 'No screen capture source was found. Please try again.';
                errorType = 'no_source';
            } else if (error.name === 'AbortError') {
                errorMessage = 'Screen recording was cancelled. Please try again.';
                errorType = 'user_cancelled';
            } else {
                errorMessage = 'Failed to start recording: ' + error.message;
                errorType = 'generic_error';
            }
            
            // Notify background script of error
            chrome.runtime.sendMessage({
                action: 'recordingError',
                error: errorMessage,
                errorType: errorType
            });
        }
    }
    
    function processRecording() {
        if (recordedChunks.length === 0) {
            console.error('No video data recorded');
            return;
        }
        
        const blob = new Blob(recordedChunks, {
            type: mediaRecorder.mimeType || 'video/webm'
        });
        
        console.log('Video blob created:', blob.size, 'bytes');
        
        // Stop interaction tracking
        stopInteractionTracking();
        
        // Notify background script with the recording for immediate download
        chrome.runtime.sendMessage({
            action: 'recordingStopped',
            videoBlob: blob,
            interactionLog: localInteractionLog,
            mimeType: mediaRecorder.mimeType
        });
    }
    
    // Make stopRecording available globally for the injected script
    window.stopRecording = function() {
        if (!isRecording || !mediaRecorder) {
            console.log('No recording in progress');
            return;
        }
        
        console.log('Stopping recording...');
        
        try {
            mediaRecorder.stop();
            
            // Stop all tracks
            if (mediaRecorder.stream) {
                mediaRecorder.stream.getTracks().forEach(track => {
                    track.stop();
                    console.log('Stopped track:', track.kind);
                });
            }
            
            isRecording = false;
        } catch (error) {
            console.error('Error stopping recording:', error);
        }
    };
    
    // Interaction tracking functions
    function startInteractionTracking() {
        if (isTracking) return;
        
        isTracking = true;
        createTrackingIndicator();
        
        document.addEventListener('click', handleClick, true);
        document.addEventListener('scroll', handleScroll, true);
        document.addEventListener('keydown', handleKeydown, true);
        
        console.log('Interaction tracking started');
    }
    
    function stopInteractionTracking() {
        if (!isTracking) return;
        
        isTracking = false;
        
        if (trackingIndicator && trackingIndicator.parentNode) {
            trackingIndicator.parentNode.removeChild(trackingIndicator);
            trackingIndicator = null;
        }
        
        document.removeEventListener('click', handleClick, true);
        document.removeEventListener('scroll', handleScroll, true);
        document.removeEventListener('keydown', handleKeydown, true);
        
        console.log('Interaction tracking stopped');
    }
    
    function createTrackingIndicator() {
        trackingIndicator = document.createElement('div');
        trackingIndicator.style.cssText = `
            position: fixed !important;
            top: 10px !important;
            right: 10px !important;
            background: rgba(255, 0, 0, 0.9) !important;
            color: white !important;
            padding: 8px 12px !important;
            border-radius: 5px !important;
            font-family: Arial, sans-serif !important;
            font-size: 12px !important;
            font-weight: bold !important;
            z-index: 2147483647 !important;
            pointer-events: none !important;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3) !important;
            border: 1px solid rgba(255,255,255,0.2) !important;
        `;
        trackingIndicator.textContent = '🔴 Recording & Tracking';
        document.body.appendChild(trackingIndicator);
    }
    
    function handleClick(event) {
        if (!isTracking) return;
        
        const interaction = {
            type: 'click',
            x: event.clientX,
            y: event.clientY,
            target: getElementDescription(event.target),
            timestamp: Date.now(),
            url: window.location.href
        };
        
        localInteractionLog.push(interaction);
    }
    
    function handleScroll(event) {
        if (!isTracking) return;
        
        // Throttle scroll events
        if (handleScroll.lastLog && Date.now() - handleScroll.lastLog < 250) {
            return;
        }
        handleScroll.lastLog = Date.now();
        
        const interaction = {
            type: 'scroll',
            x: window.scrollX,
            y: window.scrollY,
            target: 'window',
            timestamp: Date.now(),
            url: window.location.href
        };
        
        localInteractionLog.push(interaction);
    }
    
    function handleKeydown(event) {
        if (!isTracking) return;
        
        const functionalKeys = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
        
        if (functionalKeys.includes(event.key)) {
            const interaction = {
                type: 'keydown',
                key: event.key,
                target: getElementDescription(event.target),
                timestamp: Date.now(),
                url: window.location.href
            };
            
            localInteractionLog.push(interaction);
        }
    }
    
    function getElementDescription(element) {
        let description = element.tagName.toLowerCase();
        
        if (element.id) {
            description += `#${element.id}`;
        }
        
        if (element.className && typeof element.className === 'string') {
            description += `.${element.className.split(' ').filter(c => c).join('.')}`;
        }
        
        if (['BUTTON', 'A'].includes(element.tagName)) {
            const text = element.textContent.trim().substring(0, 30);
            if (text) {
                description += ` "${text}${text.length > 30 ? '...' : ''}"`;
            }
        }
        
        return description;
    }
}

// Function to be injected to stop recording
function stopRecording() {
    if (window.stopRecording) {
        window.stopRecording();
    }
}

async function processAndDownloadRecording(videoBlob, interactionLog) {
    try {
        console.log('Starting download process...');
        console.log('Video blob size:', videoBlob?.size || 'undefined');
        console.log('Interaction log length:', interactionLog?.length || 'undefined');
        
        // Validate inputs
        if (!videoBlob) {
            throw new Error('No video blob provided');
        }
        
        if (!(videoBlob instanceof Blob)) {
            throw new Error('Invalid video blob format');
        }
        
        const timestamp = new Date().toISOString().slice(0,19).replace(/:/g, '-');
        
        // Determine video file extension and mime type
        let videoExtension = 'webm';
        let videoMimeType = videoBlob.type || 'video/webm';
        
        console.log('Original video MIME type:', videoMimeType);
        
        if (videoMimeType.includes('mp4')) {
            videoExtension = 'mp4';
        } else if (videoMimeType.includes('webm')) {
            videoExtension = 'webm';
        }
        
        console.log('Using file extension:', videoExtension);
        
        // Create object URL for video
        const videoUrl = URL.createObjectURL(videoBlob);
        console.log('Video URL created');
        
        // Download video file
        const videoFilename = `screen-recording-${timestamp}.${videoExtension}`;
        console.log('Downloading video as:', videoFilename);
        
        await new Promise((resolve, reject) => {
            chrome.downloads.download({
                url: videoUrl,
                filename: videoFilename,
                saveAs: false
            }, function(downloadId) {
                if (chrome.runtime.lastError) {
                    console.error('Video download failed:', chrome.runtime.lastError);
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    console.log('Video download started with ID:', downloadId);
                    resolve(downloadId);
                }
            });
        });
        
        // Clean up video URL after delay
        setTimeout(() => {
            try {
                URL.revokeObjectURL(videoUrl);
                console.log('Video URL cleaned up');
            } catch (e) {
                console.warn('Error cleaning up video URL:', e);
            }
        }, 5000);
        
        // Create and download interactions as TXT file if available
        if (interactionLog && Array.isArray(interactionLog) && interactionLog.length > 0) {
            console.log('Processing interaction log...');
            
            try {
                const interactionsText = formatInteractionsAsTxt(interactionLog, timestamp);
                console.log('Interactions formatted, length:', interactionsText.length);
                
                const txtBlob = new Blob([interactionsText], {
                    type: 'text/plain;charset=utf-8'
                });
                const txtUrl = URL.createObjectURL(txtBlob);
                
                const txtFilename = `user-interactions-${timestamp}.txt`;
                console.log('Downloading interactions as:', txtFilename);
                
                await new Promise((resolve, reject) => {
                    chrome.downloads.download({
                        url: txtUrl,
                        filename: txtFilename,
                        saveAs: false
                    }, function(downloadId) {
                        if (chrome.runtime.lastError) {
                            console.error('Interactions download failed:', chrome.runtime.lastError);
                            reject(new Error(chrome.runtime.lastError.message));
                        } else {
                            console.log('Interactions download started with ID:', downloadId);
                            resolve(downloadId);
                        }
                    });
                });
                
                // Clean up TXT URL after delay
                setTimeout(() => {
                    try {
                        URL.revokeObjectURL(txtUrl);
                        console.log('TXT URL cleaned up');
                    } catch (e) {
                        console.warn('Error cleaning up TXT URL:', e);
                    }
                }, 5000);
                
            } catch (txtError) {
                console.error('Error processing interactions:', txtError);
                // Don't fail the whole process if interactions fail
            }
        } else {
            console.log('No interactions to download');
        }
        
        console.log('Download process completed successfully');
        
    } catch (error) {
        console.error('Error in processAndDownloadRecording:', error);
        console.error('Error stack:', error.stack);
        throw error; // Re-throw to be caught by caller
    }
}

function formatInteractionsAsTxt(interactionLog, timestamp) {
    try {
        console.log('Formatting interactions, count:', interactionLog.length);
        
        let output = '';
        output += '='.repeat(60) + '\n';
        output += '           SCREEN RECORDING - USER INTERACTIONS\n';
        output += '='.repeat(60) + '\n';
        output += `Recording Date: ${new Date().toLocaleString()}\n`;
        output += `Total Interactions: ${interactionLog.length}\n`;
        output += `Generated: ${timestamp}\n`;
        output += '='.repeat(60) + '\n\n';
        
        if (interactionLog.length === 0) {
            output += 'No user interactions were recorded.\n';
            return output;
        }
        
        // Group interactions by type for summary
        const summary = {};
        interactionLog.forEach(interaction => {
            const type = interaction.type || 'unknown';
            summary[type] = (summary[type] || 0) + 1;
        });
        
        output += 'SUMMARY:\n';
        output += '-'.repeat(20) + '\n';
        Object.entries(summary).forEach(([type, count]) => {
            output += `${type.toUpperCase()}: ${count} times\n`;
        });
        output += '\n';
        
        output += 'DETAILED LOG:\n';
        output += '-'.repeat(20) + '\n';
        
        const startTime = interactionLog[0]?.timestamp || Date.now();
        
        interactionLog.forEach((interaction, index) => {
            try {
                const relativeTime = interaction.timestamp ? 
                    ((interaction.timestamp - startTime) / 1000).toFixed(1) : 'unknown';
                
                output += `[${String(index + 1).padStart(3, '0')}] `;
                output += `${relativeTime}s - `;
                
                const type = interaction.type || 'unknown';
                
                switch (type) {
                    case 'click':
                        output += `CLICK at (${interaction.x || 0}, ${interaction.y || 0})`;
                        if (interaction.target) {
                            output += ` on ${interaction.target}`;
                        }
                        break;
                        
                    case 'scroll':
                        output += `SCROLL to (${interaction.x || 0}, ${interaction.y || 0})`;
                        break;
                        
                    case 'keydown':
                        output += `KEY PRESS: ${interaction.key || 'unknown'}`;
                        if (interaction.target) {
                            output += ` in ${interaction.target}`;
                        }
                        break;
                        
                    default:
                        output += `${type.toUpperCase()}`;
                        if (interaction.x !== undefined && interaction.y !== undefined) {
                            output += ` at (${interaction.x}, ${interaction.y})`;
                        }
                        break;
                }
                
                if (interaction.url) {
                    // Truncate long URLs
                    const url = interaction.url.length > 50 ? 
                        interaction.url.substring(0, 47) + '...' : 
                        interaction.url;
                    output += ` [${url}]`;
                }
                
                output += '\n';
                
            } catch (entryError) {
                console.warn('Error formatting interaction entry:', entryError);
                output += `[${String(index + 1).padStart(3, '0')}] Error formatting interaction\n`;
            }
        });
        
        output += '\n';
        output += '='.repeat(60) + '\n';
        output += 'End of Recording Log\n';
        output += '='.repeat(60) + '\n';
        
        console.log('Interactions formatted successfully, output length:', output.length);
        return output;
        
    } catch (error) {
        console.error('Error in formatInteractionsAsTxt:', error);
        // Return basic error message instead of failing completely
        return `Error formatting interactions: ${error.message}\n\nRaw data:\n${JSON.stringify(interactionLog, null, 2)}`;
    }
}