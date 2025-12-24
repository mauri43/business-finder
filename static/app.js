/**
 * Business Finder - Frontend JavaScript
 *
 * Handles:
 * - Google Places Autocomplete initialization
 * - Search form submission
 * - Results display
 * - Client-side CSV export
 */

// Global state - stores search results for CSV export
window.searchResults = [];

// DOM Elements (initialized after DOM loads)
let addressInput, latInput, lngInput, placeIdInput, formattedAddressInput;
let queryInput, minReviewsInput, radiusSlider, radiusDisplay, radiusUnit;
let searchBtn, downloadBtn;
let statusMessage, resultsSection, resultsBody, resultsCount;
let locationStatus;

// Autocomplete instance
let autocomplete;

/**
 * Initialize Google Places Autocomplete
 * This function is called by the Google Maps API callback
 */
function initAutocomplete() {
    // Get the address input element
    const input = document.getElementById('address-input');

    if (!input) {
        console.error('Address input not found');
        return;
    }

    // Create Autocomplete instance
    // Restrict to addresses and establishments for better UX
    autocomplete = new google.maps.places.Autocomplete(input, {
        types: ['geocode', 'establishment'],
        fields: ['formatted_address', 'place_id', 'geometry']
    });

    // Listen for place selection
    autocomplete.addListener('place_changed', onPlaceSelected);

    console.log('Autocomplete initialized');
}

/**
 * Handle place selection from Autocomplete dropdown
 * Captures location data and stores in hidden inputs
 */
function onPlaceSelected() {
    const place = autocomplete.getPlace();

    if (!place.geometry || !place.geometry.location) {
        // User typed something but didn't select from dropdown
        showLocationStatus('Please select a location from the dropdown', 'error');
        clearLocationData();
        return;
    }

    // Extract and store location data
    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();
    const placeId = place.place_id || '';
    const formattedAddress = place.formatted_address || '';

    // Store in hidden inputs
    document.getElementById('lat').value = lat;
    document.getElementById('lng').value = lng;
    document.getElementById('place-id').value = placeId;
    document.getElementById('formatted-address').value = formattedAddress;

    // Update UI
    showLocationStatus(`Selected: ${formattedAddress}`, 'success');
    updateSearchButtonState();

    console.log('Location selected:', { lat, lng, placeId, formattedAddress });
}

/**
 * Clear stored location data
 */
function clearLocationData() {
    document.getElementById('lat').value = '';
    document.getElementById('lng').value = '';
    document.getElementById('place-id').value = '';
    document.getElementById('formatted-address').value = '';
    updateSearchButtonState();
}

/**
 * Show location status message
 */
function showLocationStatus(message, type) {
    const status = document.getElementById('location-status');
    status.textContent = message;
    status.className = 'status-text ' + (type || '');
}

/**
 * Update search button enabled/disabled state
 */
function updateSearchButtonState() {
    const lat = document.getElementById('lat').value;
    const lng = document.getElementById('lng').value;
    const query = document.getElementById('query-input').value.trim();

    const searchBtn = document.getElementById('search-btn');
    searchBtn.disabled = !(lat && lng && query);
}

/**
 * Update radius display when slider changes
 */
function updateRadiusDisplay() {
    const slider = document.getElementById('radius-slider');
    const display = document.getElementById('radius-display');
    display.textContent = slider.value;
}

/**
 * Convert radius to meters based on selected unit
 */
function getRadiusInMeters() {
    const value = parseFloat(document.getElementById('radius-slider').value);
    const unit = document.getElementById('radius-unit').value;

    if (unit === 'miles') {
        // 1 mile = 1609.34 meters
        return Math.round(value * 1609.34);
    } else {
        // 1 km = 1000 meters
        return Math.round(value * 1000);
    }
}

/**
 * Show status message to user
 */
function showStatus(message, type) {
    const statusEl = document.getElementById('status-message');
    statusEl.textContent = message;
    statusEl.className = 'status-message ' + (type || '');
    statusEl.classList.remove('hidden');
}

/**
 * Hide status message
 */
function hideStatus() {
    const statusEl = document.getElementById('status-message');
    statusEl.classList.add('hidden');
}

/**
 * Perform the business search
 */
async function performSearch() {
    const lat = document.getElementById('lat').value;
    const lng = document.getElementById('lng').value;
    const query = document.getElementById('query-input').value.trim();
    const minReviews = parseInt(document.getElementById('min-reviews').value) || 0;
    const radiusMeters = getRadiusInMeters();

    // Validate
    if (!lat || !lng) {
        showStatus('Please select a location from the dropdown', 'error');
        return;
    }
    if (!query) {
        showStatus('Please enter a business type to search for', 'error');
        return;
    }

    // Update UI for loading state
    const searchBtn = document.getElementById('search-btn');
    searchBtn.disabled = true;
    searchBtn.textContent = 'Searching...';
    showStatus('Searching for businesses... This may take a moment.', 'info');

    // Clear previous results
    window.searchResults = [];
    document.getElementById('download-btn').disabled = true;
    document.getElementById('results-section').classList.add('hidden');

    try {
        // Send search request to backend
        const response = await fetch('/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                query: query,
                lat: parseFloat(lat),
                lng: parseFloat(lng),
                radius_meters: radiusMeters,
                min_reviews: minReviews
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Search failed');
        }

        // Store results for CSV export
        window.searchResults = data.results || [];

        // Display results
        displayResults(data);

        // Update status
        if (window.searchResults.length > 0) {
            showStatus(
                `Found ${data.filtered_count} matching businesses out of ${data.total_found} total`,
                'success'
            );
            document.getElementById('download-btn').disabled = false;
        } else {
            showStatus(
                'No businesses found matching your criteria. Try adjusting filters.',
                'warning'
            );
        }

    } catch (error) {
        console.error('Search error:', error);
        showStatus(`Error: ${error.message}`, 'error');
    } finally {
        // Reset button state
        searchBtn.disabled = false;
        searchBtn.textContent = 'Search';
        updateSearchButtonState();
    }
}

/**
 * Display search results in the table
 */
function displayResults(data) {
    const results = data.results || [];
    const tbody = document.getElementById('results-body');
    const resultsSection = document.getElementById('results-section');
    const resultsCount = document.getElementById('results-count');

    // Clear existing rows
    tbody.innerHTML = '';

    if (results.length === 0) {
        resultsSection.classList.add('hidden');
        return;
    }

    // Update count display
    resultsCount.textContent = `${results.length} businesses`;

    // Add rows for each result
    results.forEach(business => {
        const row = document.createElement('tr');

        // Name
        const nameCell = document.createElement('td');
        nameCell.textContent = business.name || '-';
        row.appendChild(nameCell);

        // Address
        const addressCell = document.createElement('td');
        addressCell.textContent = business.address || '-';
        row.appendChild(addressCell);

        // Phone
        const phoneCell = document.createElement('td');
        phoneCell.textContent = business.phone || '-';
        row.appendChild(phoneCell);

        // Website (with link if present)
        const websiteCell = document.createElement('td');
        if (business.website) {
            const link = document.createElement('a');
            link.href = business.website;
            link.textContent = truncateUrl(business.website);
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            websiteCell.appendChild(link);
        } else {
            websiteCell.textContent = 'None';
            websiteCell.classList.add('no-website');
        }
        row.appendChild(websiteCell);

        // Reviews
        const reviewsCell = document.createElement('td');
        reviewsCell.textContent = business.reviews || '0';
        row.appendChild(reviewsCell);

        // Rating
        const ratingCell = document.createElement('td');
        ratingCell.textContent = business.rating ? business.rating.toFixed(1) : '-';
        row.appendChild(ratingCell);

        tbody.appendChild(row);
    });

    // Show results section
    resultsSection.classList.remove('hidden');
}

/**
 * Truncate URL for display
 */
function truncateUrl(url) {
    try {
        const urlObj = new URL(url);
        let display = urlObj.hostname;
        if (display.startsWith('www.')) {
            display = display.substring(4);
        }
        return display;
    } catch {
        return url.substring(0, 30) + (url.length > 30 ? '...' : '');
    }
}

/**
 * Export results to CSV - CLIENT-SIDE IMPLEMENTATION
 *
 * This function:
 * 1. Takes the stored results from window.searchResults
 * 2. Converts them to CSV format with proper escaping
 * 3. Creates a Blob and triggers download
 *
 * CSV escaping rules:
 * - All fields wrapped in double quotes
 * - Internal quotes escaped by doubling them
 * - Line breaks removed/replaced
 */
function exportToCSV() {
    const results = window.searchResults;

    if (!results || results.length === 0) {
        showStatus('No results to export', 'warning');
        return;
    }

    // Fixed header order as specified
    const headers = ['name', 'address', 'phone', 'website', 'reviews', 'rating', 'place_id'];

    // Build CSV content
    const csvRows = [];

    // Add header row
    csvRows.push(headers.join(','));

    // Add data rows
    results.forEach(business => {
        const row = headers.map(header => {
            let value = business[header];

            // Handle null/undefined
            if (value === null || value === undefined) {
                value = '';
            }

            // Convert to string
            value = String(value);

            // CSV escaping:
            // 1. Remove or replace line breaks
            value = value.replace(/\r\n/g, ' ').replace(/\r/g, ' ').replace(/\n/g, ' ');

            // 2. Escape double quotes by doubling them
            value = value.replace(/"/g, '""');

            // 3. Wrap in double quotes
            return '"' + value + '"';
        });

        csvRows.push(row.join(','));
    });

    // Join all rows with newlines
    const csvContent = csvRows.join('\r\n');

    // Create Blob with CSV content
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

    // Create download link and trigger download
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', 'results.csv');
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Clean up the URL object
    URL.revokeObjectURL(url);

    showStatus(`Exported ${results.length} results to results.csv`, 'success');
}

/**
 * Initialize event listeners when DOM is ready
 */
document.addEventListener('DOMContentLoaded', function() {
    // Radius slider updates
    const radiusSlider = document.getElementById('radius-slider');
    radiusSlider.addEventListener('input', updateRadiusDisplay);

    // Query input updates search button state
    const queryInput = document.getElementById('query-input');
    queryInput.addEventListener('input', updateSearchButtonState);

    // Address input - clear location if user types after selecting
    const addressInput = document.getElementById('address-input');
    addressInput.addEventListener('input', function() {
        // If user is typing (not from autocomplete), reset location data
        // This ensures they must select from dropdown
        const lat = document.getElementById('lat').value;
        if (lat) {
            // Only clear if something was previously selected
            // and user is now typing something different
            clearLocationData();
            showLocationStatus('Type and select a location from the dropdown', '');
        }
    });

    // Search button click
    const searchBtn = document.getElementById('search-btn');
    searchBtn.addEventListener('click', performSearch);

    // Download button click
    const downloadBtn = document.getElementById('download-btn');
    downloadBtn.addEventListener('click', exportToCSV);

    // Enter key in inputs triggers search
    [queryInput, addressInput].forEach(input => {
        input.addEventListener('keypress', function(e) {
            if (e.key === 'Enter' && !document.getElementById('search-btn').disabled) {
                performSearch();
            }
        });
    });

    // Initialize display
    updateRadiusDisplay();

    console.log('Business Finder initialized');
});
