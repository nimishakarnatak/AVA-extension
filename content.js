let isTracking = false;
let trackingIndicator = null;

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'startTracking') {
        startInteractionTracking();
        sendResponse({success: true});
    } else if (request.action === 'stopTracking') {
        stopInteractionTracking();
        sendResponse({success: true});
    }
});

function startInteractionTracking() {
    if (isTracking) return;
    
    isTracking = true;
    createTrackingIndicator();
    
    document.addEventListener('click', handleClick, true);
    document.addEventListener('scroll', handleScroll, true);
    document.addEventListener('keydown', handleKeydown, true);
    
    console.log('User interaction tracking started (with consent)');
}

function stopInteractionTracking() {
    if (!isTracking) return;
    
    isTracking = false;
    
    if (trackingIndicator) {
        trackingIndicator.remove();
        trackingIndicator = null;
    }
    
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('scroll', handleScroll, true);
    document.removeEventListener('keydown', handleKeydown, true);
    
    console.log('User interaction tracking stopped');
}

function createTrackingIndicator() {
    trackingIndicator = document.createElement('div');
    trackingIndicator.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        background: rgba(255, 0, 0, 0.8);
        color: white;
        padding: 5px 10px;
        border-radius: 5px;
        font-family: Arial, sans-serif;
        font-size: 12px;
        z-index: 999999;
        pointer-events: none;
    `;
    trackingIndicator.textContent = '🔴 Recording & Tracking';
    document.body.appendChild(trackingIndicator);
}

function handleClick(event) {
    if (!isTracking) return;
    
    const target = event.target;
    const rect = target.getBoundingClientRect();
    
    logInteraction({
        type: 'click',
        x: event.clientX,
        y: event.clientY,
        target: getElementDescription(target),
        elementBounds: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height
        }
    });
}

function handleScroll(event) {
    if (!isTracking) return;
    
    if (handleScroll.lastLog && Date.now() - handleScroll.lastLog < 500) {
        return;
    }
    handleScroll.lastLog = Date.now();
    
    logInteraction({
        type: 'scroll',
        x: window.scrollX,
        y: window.scrollY,
        target: 'window'
    });
}

function handleKeydown(event) {
    if (!isTracking) return;
    
    const functionalKeys = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    
    if (functionalKeys.includes(event.key)) {
        logInteraction({
            type: 'keydown',
            key: event.key,
            target: getElementDescription(event.target)
        });
    }
}

function getElementDescription(element) {
    let description = element.tagName.toLowerCase();
    
    if (element.id) {
        description += `#${element.id}`;
    }
    
    if (element.className) {
        description += `.${element.className.split(' ').join('.')}`;
    }
    
    if (['BUTTON', 'A'].includes(element.tagName)) {
        const text = element.textContent.trim().substring(0, 20);
        if (text) {
            description += ` "${text}${text.length > 20 ? '...' : ''}"`;
        }
    }
    
    return description;
}

function logInteraction(data) {
    chrome.runtime.sendMessage({
        action: 'logInteraction',
        data: data
    });
}
