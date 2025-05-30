#!/usr/bin/env python3
"""
Test script for the new label suggestion feature
"""
import requests
import json

# Configuration
API_BASE_URL = 'http://localhost:5000/api'
TEST_PROJECT_ID = 1  # Update this to match your test project

def test_suggest_label():
    """Test the suggest label endpoint"""
    
    # Sample chip descriptions for testing
    test_descriptions = [
        "A person walking on the sidewalk",
        "Individual crossing the street",
        "Pedestrian near the crosswalk",
        "Person with backpack walking",
        "Human figure in motion"
    ]
    
    # Prepare request data
    request_data = {
        'project_id': TEST_PROJECT_ID,
        'chip_descriptions': test_descriptions
    }
    
    print(f"Testing suggest label endpoint...")
    print(f"Project ID: {TEST_PROJECT_ID}")
    print(f"Number of descriptions: {len(test_descriptions)}")
    print(f"Sample descriptions: {test_descriptions[:3]}")
    
    try:
        # Make the API call
        response = requests.post(
            f'{API_BASE_URL}/suggest-label',
            json=request_data,
            headers={'Content-Type': 'application/json'}
        )
        
        print(f"\nResponse Status: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            print(f"✅ Success!")
            print(f"Suggested Label: '{result['suggested_label']}'")
            print(f"Descriptions Count: {result['descriptions_count']}")
            print(f"Project ID: {result['project_id']}")
        else:
            print(f"❌ Error: {response.status_code}")
            try:
                error_data = response.json()
                print(f"Error message: {error_data.get('error', 'Unknown error')}")
            except:
                print(f"Raw response: {response.text}")
                
    except requests.exceptions.ConnectionError:
        print("❌ Connection Error: Could not connect to the API server.")
        print("Make sure the ozni-combine Flask server is running on localhost:5000")
    except Exception as e:
        print(f"❌ Unexpected error: {e}")

def test_with_different_descriptions():
    """Test with different types of descriptions"""
    
    test_cases = [
        {
            'name': 'Vehicles',
            'descriptions': [
                "Red car parked on street",
                "Blue sedan driving down road",
                "Vehicle at intersection",
                "Automobile in parking lot"
            ]
        },
        {
            'name': 'Animals',
            'descriptions': [
                "Dog running in park",
                "Cat sitting on fence",
                "Bird flying overhead",
                "Pet animal in yard"
            ]
        },
        {
            'name': 'Buildings',
            'descriptions': [
                "Tall office building",
                "Residential house with garden",
                "Commercial structure downtown",
                "Architectural building facade"
            ]
        }
    ]
    
    for test_case in test_cases:
        print(f"\n{'='*50}")
        print(f"Testing: {test_case['name']}")
        print(f"{'='*50}")
        
        request_data = {
            'project_id': TEST_PROJECT_ID,
            'chip_descriptions': test_case['descriptions']
        }
        
        try:
            response = requests.post(
                f'{API_BASE_URL}/suggest-label',
                json=request_data,
                headers={'Content-Type': 'application/json'}
            )
            
            if response.status_code == 200:
                result = response.json()
                print(f"✅ Suggested Label: '{result['suggested_label']}'")
            else:
                print(f"❌ Error: {response.status_code}")
                
        except Exception as e:
            print(f"❌ Error: {e}")

if __name__ == '__main__':
    print("🧪 Testing Label Suggestion Feature")
    print("=" * 60)
    
    # Basic test
    test_suggest_label()
    
    # Extended tests with different categories
    test_with_different_descriptions()
    
    print(f"\n{'='*60}")
    print("🏁 Testing completed!")
