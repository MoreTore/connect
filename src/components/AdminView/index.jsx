import React, { Component } from 'react';
import { connect } from 'react-redux';
import Obstruction from 'obstruction';

import ReactMapGL, { LinearInterpolator, GeolocateControl, HTMLOverlay, Marker, Source, WebMercatorViewport, Layer } from 'react-map-gl';
import { withStyles, Typography, CircularProgress, Button } from '@material-ui/core';
import ArrowBackIcon from '@material-ui/icons/ArrowBack';

import Colors from '../../colors';
import { fetchDriveCoords } from '../../actions/cached';
import { athena as Athena, devices as Devices, navigation as NavigationApi } from '@moretore/api';
import { primeNav, analyticsEvent, setCurrentView } from '../../actions';
import { DEFAULT_LOCATION, forwardLookup, getDirections, MAPBOX_STYLE, MAPBOX_TOKEN, networkPositioning, reverseLookup } from '../../utils/geocode';

const styles = () => ({
  noWrap: {
    whiteSpace: 'nowrap',
  },
  mapContainer: {
    position: 'relative',
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
  },
  mapError: {
    position: 'relative',
    marginTop: 20,
    marginLeft: 20,
    '& p': { color: Colors.white50 },
  },
  loadingIndicator: {
    position: 'fixed',
    bottom: 20,
    right: 20,
    zIndex: 999,
    display: 'flex',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: '8px 15px',
    borderRadius: 4,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)'
  },
  loadingText: {
    color: Colors.white,
    marginLeft: 10,
    fontSize: 14,
  },
  mapWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  adminViewRoot: {
    position: 'relative',
    width: '100%',
    height: 'calc(100vh - 96px)',
    maxHeight: 'calc(100vh - 96px)',
    overflow: 'hidden'
  },
  backButton: {
    position: 'absolute',
    top: 20,
    left: 20,
    zIndex: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    color: Colors.white,
    '&:hover': {
      backgroundColor: 'rgba(0, 0, 0, 0.9)',
    }
  }
});

// Helper function to process items with a concurrency limit.
function processWithConcurrencyLimit(items, processItem, concurrencyLimit) {
  let index = 0;
  let active = 0;
  const results = [];

  return new Promise((resolve, reject) => {
    function next() {
      while (active < concurrencyLimit && index < items.length) {
        const currentIndex = index++;
        active++;
        Promise.resolve(processItem(items[currentIndex]))
          .then((result) => {
            results[currentIndex] = result;
            active--;
            if (index >= items.length && active === 0) {
              resolve(results);
            } else {
              next();
            }
          })
          .catch((err) => {
            active--;
            console.error('Error processing item:', err);
            next(); // Continue processing remaining items.
          });
      }
    }
    next();
  });
}


// Calculate perpendicular distance from a point to a line
function perpendicularDistance(point, lineStart, lineEnd) {
  const [x, y] = point;
  const [x1, y1] = lineStart;
  const [x2, y2] = lineEnd;
  
  // Calculate the line length
  const lineLength = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
  
  if (lineLength === 0) return 0;
  
  // Calculate the distance from point to line
  const distance = Math.abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1) / lineLength;
  return distance;
}

class AdminView extends Component {
  constructor(props) {
    super(props);
    this.state = {
      viewport: {
        latitude: 37.7749,
        longitude: -122.4194,
        zoom: 10,
        bearing: 0,
        pitch: 0,
        transitionDuration: 0 // Disable automatic transitions for manual interactions
      },
      mapError: null,
      coords_loaded: false,
      loading: false,
      totalRoutes: 0,
      completedRoutes: 0,
      lastProgressUpdate: 0, // Track the last progress update time to prevent flickering
      deviceLocation: null,
      deviceLocationTime: null,
    };

    this.viewportChange = this.viewportChange.bind(this);
    this.initMap = this.initMap.bind(this);
    this.setPath = this.setPath.bind(this);
    this.checkWebGLSupport = this.checkWebGLSupport.bind(this);
    this.processCurrentRoutes = this.processCurrentRoutes.bind(this);
    this.getDeviceLastLocation = this.getDeviceLastLocation.bind(this);
    this.moveViewportToDevice = this.moveViewportToDevice.bind(this);

    
    // Store data in non-reactive instance variables to avoid React overhead
    this.routeCoordinates = [];
    this.pendingRoutes = [];
    this.mapDataCache = null; // Cache for GeoJSON data to avoid recreating large objects
    this.simplificationTolerance = 0.0001; // Adjust based on your data scale
    this.isProcessingRoutes = false;
    this.processedRouteIds = new Set(); // Track which routes have been processed to prevent duplicates
    this.lastDrawTime = 0; // Track last time map was updated to throttle updates
    this.minimumUpdateInterval = 250; // Minimum time between map updates in milliseconds (reduced for more frequent updates)
  
  }

  viewportChange(newViewport) {
    // Don't use JSON.stringify - it's inefficient for frequent updates
    // Only update the necessary viewport properties
    this.setState(prevState => ({
      viewport: {
        ...prevState.viewport,
        latitude: newViewport.latitude,
        longitude: newViewport.longitude,
        zoom: newViewport.zoom,
        bearing: newViewport.bearing,
        pitch: newViewport.pitch
      }
    }));
  }

  async getDeviceLastLocation() {
    const { device } = this.props;
    // Skip for shared devices if needed
    if (device && device.shared) {
      return;
    }
    
    try {
      // Get the dongleId from your current device or props
      const dongleId = this.props.device?.dongle_id || this.props.dongleId;
      if (!dongleId) {
        console.warn('No dongleId available to fetch device location');
        return;
      }
  
      console.log('Fetching device location for:', dongleId);
      const resp = await Devices.fetchLocation(dongleId);
      
      if (this.mounted) {
        console.log('Device location received:', resp);
        this.setState({
          deviceLocation: [resp.lng, resp.lat],
          deviceLocationTime: resp.time
        }, () => {
          // Move viewport to device location after state is updated
          this.moveViewportToDevice();
        });
      }
    } catch (err) {
      console.error('Error fetching device location:', err);
    }
  }
  
  moveViewportToDevice() {
    const { deviceLocation } = this.state;
    
    if (!deviceLocation || !this.mounted) {
      return;
    }
    
    // Update the viewport to center on the device location
    this.setState((prevState) => ({
      viewport: {
        ...prevState.viewport,
        longitude: deviceLocation[0],
        latitude: deviceLocation[1],
        zoom: 12, // Adjust zoom level as needed
        //transitionDuration: 1000, // Smooth transition in milliseconds
      }
    }));
    
    console.log('Moved viewport to device location:', deviceLocation);
  }


  componentDidMount() {
    this.mounted = true;
    this.checkWebGLSupport();
    this.getDeviceLastLocation();
  }

  componentWillUnmount() {
    this.mounted = false;
    // Clean up map resources
    if (this.map) {
      const map = this.map.getMap();
      if (map) {
        if (map.getLayer('routeLines')) {
          map.removeLayer('routeLines');
        }
        if (map.getSource('routes')) {
          map.removeSource('routes');
        }
      }
    }
  }

  componentDidUpdate(prevProps) {
    const { routes } = this.props;

    // Process routes if they have changed (filter or device selection changed)
    if (prevProps.routes !== routes && routes && routes.length > 0) {
      // Set loading state before clearing the map and processing routes
      if (!this.state.loading && this.state.coords_loaded) {
        // Clear the map before processing new routes
        if (this.map) {
          this.setPath([]);
        }
    
        if (this.mounted) {
          this.getDeviceLastLocation();
          this.processCurrentRoutes();
        }
      }
    }
  }


  processCurrentRoutes() {
    const { dispatch, routes } = this.props;
    
    if (!this.map || !this.mounted || !routes || routes.length === 0) {
      this.setState({ loading: false });
      return;
    }
    console.log('Processing routes:', routes.length);
    // Reset all caches and data structures
    this.routeCoordinates = [];
    this.processedRouteIds = new Set();
    
    // Set the initial total and completed routes count
    const totalRoutesCount = routes.length;
    
    // Make sure loading state is set
    this.setState({ 
      loading: true,
      totalRoutes: totalRoutesCount,
      completedRoutes: 0,
      lastProgressUpdate: Date.now(),
      coords_loaded: false
    });

    // Process routes that already have coordinates
    const routesWithCoords = routes.filter(route => !!route.driveCoords);
    if (routesWithCoords.length > 0) {
      console.log('Processing routes with coordinates:', routesWithCoords.length);
      // Process existing coordinates immediately
      const validCoords = routesWithCoords
        .map(route => {
          if (this.processedRouteIds.has(route.fullname)) return null;
          this.processedRouteIds.add(route.fullname);
          
          const driveCoords = route.driveCoords;
          if (!driveCoords) return null;
          const coords = Array.isArray(driveCoords) ? driveCoords : Object.values(driveCoords);
          return coords && coords.length > 0 ? coords : null;
        })
        .filter(coords => coords !== null);
      
      this.routeCoordinates = validCoords;
      
      // Update the map immediately with existing coordinates
      if (validCoords.length > 0) {
        this.setPath(validCoords);
      }
      
      // Update progress
      this.setState({ 
        completedRoutes: Math.min(routesWithCoords.length, totalRoutesCount),
        lastProgressUpdate: Date.now()
      });
    }
    
    // Process remaining routes that need coordinates
    const routesNeedingCoords = routes.filter(route => !route.driveCoords);
    if (routesNeedingCoords.length === 0) {
      this.isProcessingRoutes = false;
      this.setState({ 
        loading: false, 
        coords_loaded: true,
        completedRoutes: Math.min(routesWithCoords.length, totalRoutesCount),
        lastProgressUpdate: Date.now()
      });
      return;
    }
    
    // Process remaining routes with concurrency limit
    const concurrencyLimit = Math.min(5, Math.max(1, routesNeedingCoords.length / 20));
    let realCompletedCount = routesWithCoords.length;
    
    const processRoute = (route) => {
      return dispatch(fetchDriveCoords(route))
        .then(() => {
          if (!this.mounted) return route;
          realCompletedCount++;
          // Update progress periodically
          const now = Date.now();
          if (now - this.state.lastProgressUpdate > 300) {
            this.setState({
              completedRoutes: Math.min(realCompletedCount, totalRoutesCount),
              lastProgressUpdate: now
            });
          }
          return route;
        });
    };

    processWithConcurrencyLimit(routesNeedingCoords, processRoute, concurrencyLimit)
      .then(() => {
        if (this.mounted) {
          this.isProcessingRoutes = false;
          this.setState({ 
            loading: false, 
            coords_loaded: true,
            completedRoutes: Math.min(totalRoutesCount, realCompletedCount)
          });
        }
      })
      .catch((error) => {
        console.error('Error processing routes:', error);
        this.isProcessingRoutes = false;
        if (this.mounted) {
          this.setState({ loading: false });
        }
      });
  }

  setPath(coordsArray) {
    const map = this.map && this.map.getMap();
    if (!map) {
      console.warn('Map not ready, cannot set path.');
      return;
    }

    // Create GeoJSON features for all coordinates
    const features = coordsArray.map((coords, index) => ({
      type: 'Feature',
      properties: { id: index },
      geometry: {
        type: 'LineString',
        coordinates: coords,
      },
    }));

    const geojsonData = {
      type: 'FeatureCollection',
      features: features,
    };

    // Update the GeoJSON data for the routes source
    const source = map.getSource('routes');
    if (source) {
      source.setData(geojsonData);
    } else {
      console.warn('Routes source not found on the map.');
    }
  }

  checkWebGLSupport() {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl || !(gl instanceof WebGLRenderingContext)) {
      this.setState({ mapError: 'Failed to get WebGL context, your browser or device may not support WebGL.' });
    }
  }

  initMap(mapComponent) {
    if (!mapComponent) {
      this.map = null;
      return;
    }

    const map = mapComponent.getMap();
    if (!map) {
      this.map = null;
      return;
    }

    // Wait for the map style to load before adding sources and layers
    if (map.loaded()) {
      this._initializeMapSources(map);
    } else {
      map.once('style.load', () => {
        this._initializeMapSources(map);
      });
    }

    this.map = mapComponent;
  }

  _initializeMapSources(map) {
    // Remove existing source and layer if they exist
    if (map.getLayer('routeLines')) {
      map.removeLayer('routeLines');
    }
    if (map.getSource('routes')) {
      map.removeSource('routes');
    }

    // Add a GeoJSON source to hold route data
    map.addSource('routes', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [],
      },
    });

    // Add a layer to render the routes
    const lineLayer = {
      id: 'routeLines',
      type: 'line',
      source: 'routes',
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': '#2aff24',
        'line-width': 4,
      },
    };

    map.addLayer(lineLayer);
    
    // Now that map is initialized, process routes if available
    if (this.mounted && this.props.routes && this.props.routes.length > 0) {
      this.setState({ loading: true }, () => {
        setTimeout(() => {
          if (this.mounted) {
            this.processCurrentRoutes();
          }
        }, 50);
      });
    }
  }

  handleBackToDashboard = () => {
    const { dispatch } = this.props;
    dispatch(setCurrentView('dashboard'));
  }

  render() {
    const { classes } = this.props;
    const { mapError, viewport, loading, totalRoutes, completedRoutes } = this.state;
    
    // Ensure progress percentage never exceeds 100%
    const safeCompletedRoutes = Math.min(completedRoutes, totalRoutes);
    const loadingProgress = totalRoutes > 0 ? Math.round((safeCompletedRoutes / totalRoutes) * 100) : 0;

    return (
      <div className={classes.adminViewRoot}>
        <div className={classes.mapContainer}>
          {mapError && (
            <div className={classes.mapError}>
              <Typography>Could not initialize map.</Typography>
              <Typography>{mapError}</Typography>
            </div>
          )}
          <div className={classes.mapWrapper}>
            <ReactMapGL
              {...viewport}
              width="100%"
              height="100%"
              maxZoom={20}
              minZoom={2}
              mapboxApiAccessToken={MAPBOX_TOKEN}
              mapStyle={MAPBOX_STYLE}
              onViewportChange={this.viewportChange}
              onInteractionStateChange={this._onInteractionStateChange}
              onContextMenu={null}
              dragRotate={false}
              maxPitch={0}
              attributionControl={false}
              reuseMaps
              preventStyleDiffing
              asyncRender
              touchZoom={true}
              touchRotate={false}
              doubleClickZoom={true}
              scrollZoom={{ smooth: true }}
              onError={(err) => this.setState({ mapError: err.error.message })}
              ref={this.initMap}
            />
          </div>
          
          {/* Back button */}
          <Button 
            className={classes.backButton}
            variant="contained"
            startIcon={<ArrowBackIcon />}
            onClick={this.handleBackToDashboard}
          >
            Back to Dashboard
          </Button>

          {/* Always show loading indicator when loading */}
          {loading && (
            <div className={classes.loadingIndicator}>
              <CircularProgress size={24} thickness={4} style={{ color: Colors.white }} />
              <Typography className={classes.loadingText}>
                Loading routes: {safeCompletedRoutes} of {totalRoutes} ({loadingProgress}%)
              </Typography>
            </div>
          )}
        </div>
      </div>
    );
  }
}

const stateToProps = Obstruction({
  devices: 'devices',
  profile: 'profile',
  classes: 'classes',
  zoom: 'zoom',
  routes: 'routes',
  device: 'device', // Device filter passed in from Redux.
  filter: 'filter', // Filter passed in from Redux.
});

export default connect(stateToProps)(withStyles(styles)(AdminView));
