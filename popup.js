document.addEventListener('DOMContentLoaded', function() {
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const surveyBtn = document.getElementById('surveyBtn');
    const backBtn = document.getElementById('backBtn');
    const status = document.getElementById('status');
    const trackInteractions = document.getElementById('trackInteractions');
    
    // Panel elements
    const mainPanel = document.getElementById('mainPanel');
    const surveyPanel = document.getElementById('surveyPanel');
    const surveyForm = document.getElementById('surveyForm');
    const submitSurveyBtn = document.getElementById('submitSurvey');
    const surveyStatus = document.getElementById('surveyStatus');
    
    let isRecording = false;
    let hasRecording = false;
    
    // Survey button click - SHOW SURVEY PANEL
    surveyBtn.addEventListener('click', function() {
        console.log('Survey button clicked!');
        showSurveyPanel();
    });
    
    // Back button click - RETURN TO MAIN PANEL
    backBtn.addEventListener('click', function() {
        console.log('Back button clicked!');
        showMainPanel();
    });
    
    // Survey form submission
    surveyForm.addEventListener('submit', function(e) {
        e.preventDefault();
        console.log('Survey form submitted!');
        submitSurvey();
    });
    
    function showSurveyPanel() {
        mainPanel.classList.add('hidden');
        surveyPanel.classList.remove('hidden');
        console.log('Survey panel shown');
    }
    
    function showMainPanel() {
        surveyPanel.classList.add('hidden');
        mainPanel.classList.remove('hidden');
        console.log('Main panel shown');
    }
    
    function submitSurvey() {
        const formData = new FormData(surveyForm);
        const surveyData = {};
        
        // Process form data
        for (let [key, value] of formData.entries()) {
            surveyData[key] = value;
        }
        
        // Add timestamp
        surveyData.timestamp = new Date().toISOString();
        
        console.log('Survey data:', surveyData);
        
        // Show success message
        surveyStatus.textContent = 'Thank you for your feedback!';
        surveyStatus.className = 'survey-status success';
        
        // Send to background script (if you want to save it)
        chrome.runtime.sendMessage({
            action: 'submitSurvey',
            surveyData: surveyData
        }, function(response) {
            console.log('Survey submitted to background:', response);
        });
        
        // Return to main panel after 2 seconds
        setTimeout(() => {
            surveyForm.reset();
            showMainPanel();
            surveyStatus.textContent = '';
            surveyStatus.className = 'survey-status';
        }, 2000);
    }
    
    // Listen for recording status changes from background
    chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
        if (request.action === 'recordingStatusChanged') {
            isRecording = request.isRecording;
            hasRecording = request.hasRecording || hasRecording;
            
            // Handle errors from background script
            if (request.error) {
                showError(request.error, request.errorType);
                updateStatus('Recording failed', 'ready');
            }
            
            updateUI();
        }
    });
    
    // Check current recording status on popup open
    chrome.runtime.sendMessage({action: 'getStatus'}, function(response) {
        if (response) {
            isRecording = response.isRecording;
            hasRecording = response.hasRecording || false;
            updateUI();
        }
    });
    
    startBtn.addEventListener('click', function() {
        const shouldTrack = trackInteractions.checked;
        
        // Show loading state
        updateStatus('Starting recording...', 'recording');
        startBtn.disabled = true;
        
        chrome.runtime.sendMessage({
            action: 'startRecording',
            trackInteractions: shouldTrack
        }, function(response) {
            startBtn.disabled = false;
            
            if (response && response.success) {
                console.log('Recording started successfully');
            } else {
                const error = response ? response.error : 'Unknown error';
                const errorType = response ? response.errorType : 'generic_error';
                
                showError(error, errorType);
                updateStatus('Ready to Record', 'ready');
            }
        });
    });
    
    stopBtn.addEventListener('click', function() {
        updateStatus('Stopping recording and downloading files...', 'recording');
        stopBtn.disabled = true;
        
        chrome.runtime.sendMessage({action: 'stopRecording'}, function(response) {
            stopBtn.disabled = false;
            
            if (response && response.success) {
                isRecording = false;
                hasRecording = false;
                updateUI();
                updateStatus('Recording stopped! Files downloaded to your Downloads folder.', 'ready');
                
                setTimeout(() => {
                    updateStatus('Ready to Record', 'ready');
                }, 4000);
            } else {
                const error = response ? response.error : 'Failed to stop recording';
                showError(error);
                updateStatus('Recording failed', 'ready');
            }
        });
    });
    
    downloadBtn.addEventListener('click', function() {
        chrome.runtime.sendMessage({action: 'downloadRecording'});
        updateStatus('Files downloaded!', 'ready');
        
        setTimeout(() => {
            updateStatus('Ready to Record', 'ready');
            hasRecording = false;
            updateUI();
        }, 2000);
    });
    
    function updateUI() {
        if (isRecording) {
            startBtn.style.display = 'none';
            stopBtn.style.display = 'block';
            downloadBtn.style.display = 'none';
            stopBtn.textContent = 'Stop Recording & Download';
            updateStatus('Recording... Click to stop and auto-download files', 'recording');
            trackInteractions.disabled = true;
            surveyBtn.disabled = true;
        } else {
            startBtn.style.display = 'block';
            stopBtn.style.display = 'none';
            downloadBtn.style.display = 'none';
            trackInteractions.disabled = false;
            surveyBtn.disabled = false;
        }
    }
    
    function updateStatus(text, type) {
        status.textContent = text;
        status.className = `status ${type}`;
    }
    
    function showError(error, errorType) {
        let userMessage = error;
        let helpText = '';
        
        switch(errorType) {
            case 'user_cancelled':
                userMessage = 'Recording cancelled';
                helpText = 'Click "Start Recording" and then "Share" in the dialog to begin recording.';
                break;
            case 'permission_denied':
                userMessage = 'Permission denied';
                helpText = 'Please allow screen sharing when prompted and try again.';
                break;
            case 'no_source':
                userMessage = 'No screen found';
                helpText = 'Make sure you have a screen or window available to record.';
                break;
            case 'aborted':
                userMessage = 'Recording aborted';
                helpText = 'The recording was interrupted. Please try again.';
                break;
            default:
                helpText = 'Try refreshing the page or restarting Chrome.';
        }
        
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.innerHTML = `
            <strong>${userMessage}</strong><br>
            <small>${helpText}</small>
        `;
        
        const existingError = document.querySelector('.error-message');
        if (existingError) {
            existingError.remove();
        }
        
        status.parentNode.insertBefore(errorDiv, status.nextSibling);
        
        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.remove();
            }
        }, 10000);
        
        console.error('Recording error:', error, 'Type:', errorType);
    }
});