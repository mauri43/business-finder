"""
Business Finder - Flask Backend
Uses Google Places API (Nearby Search + Place Details) to find businesses
and filter them based on review count and website criteria.
"""

import os
import time
import requests
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

# Load API keys from environment variables
GOOGLE_MAPS_JS_KEY = os.environ.get('GOOGLE_MAPS_JS_KEY', '')
GOOGLE_PLACES_API_KEY = os.environ.get('GOOGLE_PLACES_API_KEY', '')

# Google Places API endpoints
NEARBY_SEARCH_URL = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json'
PLACE_DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json'

# Rate limiting settings
REQUEST_DELAY = 0.1  # Delay between requests in seconds
PAGE_TOKEN_DELAY = 2.0  # Required delay before using next_page_token
MAX_RETRIES = 3
BACKOFF_FACTOR = 2


def make_request_with_retry(url, params, max_retries=MAX_RETRIES):
    """
    Make an HTTP request with exponential backoff retry logic.
    Handles rate limits and transient errors gracefully.
    """
    for attempt in range(max_retries):
        try:
            response = requests.get(url, params=params, timeout=30)
            response.raise_for_status()
            data = response.json()

            status = data.get('status', 'UNKNOWN')

            # Handle various API statuses
            if status == 'OK' or status == 'ZERO_RESULTS':
                return data, None
            elif status == 'OVER_QUERY_LIMIT':
                # Rate limited - wait and retry
                wait_time = BACKOFF_FACTOR ** attempt
                time.sleep(wait_time)
                continue
            elif status == 'REQUEST_DENIED':
                return None, f"Request denied: {data.get('error_message', 'Check API key')}"
            elif status == 'INVALID_REQUEST':
                return None, f"Invalid request: {data.get('error_message', 'Check parameters')}"
            else:
                return None, f"API error: {status}"

        except requests.exceptions.Timeout:
            if attempt < max_retries - 1:
                time.sleep(BACKOFF_FACTOR ** attempt)
                continue
            return None, "Request timed out"
        except requests.exceptions.RequestException as e:
            if attempt < max_retries - 1:
                time.sleep(BACKOFF_FACTOR ** attempt)
                continue
            return None, f"Network error: {str(e)}"

    return None, "Max retries exceeded"


def nearby_search(query, lat, lng, radius_meters):
    """
    Perform Google Places Nearby Search with pagination.
    Returns a list of basic place results (place_id, name, etc.)
    """
    all_results = []

    params = {
        'key': GOOGLE_PLACES_API_KEY,
        'location': f'{lat},{lng}',
        'radius': radius_meters,
        'keyword': query
    }

    while True:
        data, error = make_request_with_retry(NEARBY_SEARCH_URL, params)

        if error:
            return None, error

        results = data.get('results', [])
        all_results.extend(results)

        # Check for more pages
        next_page_token = data.get('next_page_token')
        if not next_page_token:
            break

        # Google requires a delay before using next_page_token
        time.sleep(PAGE_TOKEN_DELAY)

        # Update params for next page
        params = {
            'key': GOOGLE_PLACES_API_KEY,
            'pagetoken': next_page_token
        }

        # Small delay between requests
        time.sleep(REQUEST_DELAY)

    return all_results, None


def get_place_details(place_id):
    """
    Fetch detailed information for a specific place.
    Returns: name, address, phone, website, reviews count, rating
    """
    params = {
        'key': GOOGLE_PLACES_API_KEY,
        'place_id': place_id,
        'fields': 'name,formatted_address,formatted_phone_number,website,user_ratings_total,rating,place_id'
    }

    data, error = make_request_with_retry(PLACE_DETAILS_URL, params)

    if error:
        return None, error

    result = data.get('result', {})
    return result, None


def filter_place(place_details, min_reviews):
    """
    Apply filtering logic to determine if a place should be included.

    Criteria:
    - user_ratings_total >= min_reviews
    AND either:
    - website is missing or empty
    OR
    - website contains "facebook.com" (case-insensitive)
    """
    reviews = place_details.get('user_ratings_total', 0)
    website = place_details.get('website', '')

    # Check minimum reviews requirement
    if reviews < min_reviews:
        return False

    # Check website criteria: no website OR has facebook.com
    if not website:
        return True
    if 'facebook.com' in website.lower():
        return True

    return False


@app.route('/')
def index():
    """
    Serve the main HTML page with the Google Maps JS API key injected.
    """
    return render_template('index.html', google_maps_js_key=GOOGLE_MAPS_JS_KEY)


@app.route('/search', methods=['POST'])
def search():
    """
    Main search endpoint.

    Accepts JSON:
    - query: Business type/name to search for
    - lat: Latitude of search center
    - lng: Longitude of search center
    - radius_meters: Search radius in meters
    - min_reviews: Minimum number of reviews required

    Returns JSON array of filtered business results.
    """
    try:
        data = request.get_json()

        # Validate required parameters
        query = data.get('query', '').strip()
        lat = data.get('lat')
        lng = data.get('lng')
        radius_meters = data.get('radius_meters', 5000)
        min_reviews = data.get('min_reviews', 0)

        if not query:
            return jsonify({'error': 'Business query is required'}), 400
        if lat is None or lng is None:
            return jsonify({'error': 'Location coordinates are required'}), 400

        # Convert to proper types
        try:
            lat = float(lat)
            lng = float(lng)
            radius_meters = int(radius_meters)
            min_reviews = int(min_reviews)
        except ValueError:
            return jsonify({'error': 'Invalid parameter types'}), 400

        # Clamp radius to API maximum (50km)
        radius_meters = min(radius_meters, 50000)

        # Step 1: Nearby Search to get list of places
        nearby_results, error = nearby_search(query, lat, lng, radius_meters)

        if error:
            return jsonify({'error': error}), 500

        if not nearby_results:
            return jsonify({'results': [], 'message': 'No results found'})

        # Step 2: Get details for each place and apply filters
        filtered_results = []

        for place in nearby_results:
            place_id = place.get('place_id')
            if not place_id:
                continue

            # Small delay between detail requests to avoid rate limiting
            time.sleep(REQUEST_DELAY)

            # Fetch detailed info
            details, error = get_place_details(place_id)

            if error:
                # Log error but continue with other results
                print(f"Error fetching details for {place_id}: {error}")
                continue

            # Apply filtering logic
            if filter_place(details, min_reviews):
                filtered_results.append({
                    'name': details.get('name', ''),
                    'address': details.get('formatted_address', ''),
                    'phone': details.get('formatted_phone_number', ''),
                    'website': details.get('website', ''),
                    'reviews': details.get('user_ratings_total', 0),
                    'rating': details.get('rating', 0),
                    'place_id': details.get('place_id', place_id)
                })

        return jsonify({
            'results': filtered_results,
            'total_found': len(nearby_results),
            'filtered_count': len(filtered_results)
        })

    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500


if __name__ == '__main__':
    # Validate that API keys are configured
    if not GOOGLE_MAPS_JS_KEY:
        print("WARNING: GOOGLE_MAPS_JS_KEY environment variable not set")
    if not GOOGLE_PLACES_API_KEY:
        print("WARNING: GOOGLE_PLACES_API_KEY environment variable not set")

    # Run the Flask development server
    app.run(debug=True, host='127.0.0.1', port=5000)
