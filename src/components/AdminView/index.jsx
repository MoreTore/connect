import React, { Component } from 'react';
import { connect } from 'react-redux';
import Obstruction from 'obstruction';

import ReactMapGL, { LinearInterpolator, GeolocateControl, HTMLOverlay, Marker, Source, WebMercatorViewport, Layer } from 'react-map-gl';
import { withStyles, TextField, InputAdornment, Typography, Button, Menu, MenuItem, CircularProgress, Popper }
  from '@material-ui/core';

import Colors from '../../colors';
import { checkAllRoutesData } from '../../actions';
import { fetchDriveCoords } from '../../actions/cached';
import { currentOffset } from '../../timeline';
import { athena as Athena, devices as Devices, navigation as NavigationApi } from '@moretore/api';
import { primeNav, analyticsEvent } from '../../actions';
import { DEFAULT_LOCATION, forwardLookup, getDirections, MAPBOX_STYLE, MAPBOX_TOKEN, networkPositioning, reverseLookup } from '../../utils/geocode';


const styles = () => ({
  noWrap: {
    whiteSpace: 'nowrap',
  },
  mapContainer: {
    borderBottom: `1px solid ${Colors.white10}`,
  },
  mapError: {
    position: 'relative',
    marginTop: 20,
    marginLeft: 20,
    '& p': { color: Colors.white50 },
  },
});

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
            next(); // Continue processing remaining items
          });
      }
    }
    next();
  });
}

class AdminView extends Component {
    constructor(props) {
      super(props);
      this.state = {
        viewport: {
          latitude: 37.7749,  // You can change this to any latitude
          longitude: -122.4194,  // You can change this to any longitude
          zoom: 10,  // Default zoom level
          bearing: 0,
          pitch: 0,
        },
        mapError: null,  // To track map errors
        coords_loaded: false,
        loading: false,
      };

      this.viewportChange = this.viewportChange.bind(this);  // Bind method
      this.initMap = this.initMap.bind(this);
      this.populateMap = this.populateMap.bind(this);
      this.setPath = this.setPath.bind(this);
    }
      // Handle viewport changes
    viewportChange(newViewport) {
      this.setState({ viewport: newViewport });
    }

    componentDidMount() {
      this.mounted = true;
      this.checkWebGLSupport();
      this.componentDidUpdate({}, {});
      this.fetchRoutesForDevices();
    }

    componentDidUpdate(prevProps, prevState) {
      const { dispatch, devices, allRoutes, routes } = this.props;
      console.log(devices)
      console.debug(allRoutes);
      if (prevProps.devices !== devices && devices.length > 0) {
        this.fetchRoutesForDevices();
      }
      // if (prevProps.routes !== routes) {
      //   this.state.coords_loaded = false;
      //   this.state.loading = false;
      // }
      if (this.map && !this.state.coords_loaded && !this.state.loading) {
        this.state.loading = true
        this.setPath([]);
        if (allRoutes && allRoutes.length > 0 ) {
          const concurrencyLimit = 5; // Adjust this value as needed
      
          // Define the processing function
          const processRoute = (route) => dispatch(fetchDriveCoords(route));
      
          // Use the concurrency-limited processor
          processWithConcurrencyLimit(allRoutes, processRoute, concurrencyLimit)
            .then(() => {
              // All routes have been processed
              this.populateMap();
            })
            .catch((error) => {
              console.error('Error processing routes:', error);
            });
        }
      }
    }

    setPath(coordsArray) {
      const map = this.map && this.map.getMap();
    
      if (map) {
        const features = coordsArray.map((coords, index) => ({
          type: 'Feature',
          properties: {
            id: index,
          },
          geometry: {
            type: 'LineString',
            coordinates: coords,
          },
        }));
    
        map.getSource('routes').setData({
          type: 'FeatureCollection',
          features: features,
        });
      }
    }

    fetchRoutesForDevices() {
      const { dispatch, devices, allRoutes} = this.props;
      console.debug(allRoutes);
      if (devices && devices.length > 0) {
        const dongleIds = devices.map(device => device.dongle_id);  // Assuming devices have dongleId
        dispatch(checkAllRoutesData(dongleIds));  // Pass the list of dongleIds to the action
      }
    }

    componentWillUnmount() {
      this.mounted = false;
    }

    async populateMap() {
      const { allRoutes, routes} = this.props;
      console.debug(allRoutes);
      if (!this.map || !allRoutes || !routes) {
         return;
      }
      this.state.coords_loaded = true;
        // Filter out routes that have driveCoords
      const routesWithCoords = routes.filter(route => route.driveCoords);
      // Map driveCoords to array of coordinates
      const coordsArray = routesWithCoords.map(route => Object.values(route.driveCoords));
      this.setPath(coordsArray);
      
    }


    checkWebGLSupport() {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl || !(gl instanceof WebGLRenderingContext)) {
        this.setState({ mapError: 'Failed to get WebGL context, your browser or device may not support WebGL.' });
      }
    }

    focus(ev) {
      if (!this.state.hasFocus && (!ev || !ev.srcEvent || !ev.srcEvent.path || !this.mapContainerRef.current
        || ev.srcEvent.path.includes(this.mapContainerRef.current))) {
        this.setState({ hasFocus: true });
      }
    }

    onResize(windowWidth) {
      this.setState({ windowWidth });
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
  
      map.on('load', () => {
        map.addSource('routes', { 
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [],
          },
        });
    
        const lineGeoJson = {
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
        map.addLayer(lineGeoJson);
  
        this.map = mapComponent;
      });
    }

    render() {
      const { classes, devices, zoom, profile, allRoutes } = this.props;
      const { mapError, hasFocus, search, searchLooking, searchSelect, favoriteLocations, viewport,
      windowWidth, showPrimeAd } = this.state;
      return (
        <div
          className={classes.mapContainer}
          style={{ height: '100vh', width: '100%' }}  // Full screen map
        >
          {mapError && (
            <div className={classes.mapError}>
              <Typography>Could not initialize map.</Typography>
              <Typography>{mapError}</Typography>
            </div>
          )}
          <ReactMapGL
            {...viewport}
            width="100%"
            height="100%"
            zoom={viewport.zoom}
            latitude={viewport.latitude}
            longitude={viewport.longitude}
            onViewportChange={this.viewportChange}  // Update the viewport when map is panned/zoomed
            mapboxApiAccessToken={MAPBOX_TOKEN}  // Access token
            mapStyle={MAPBOX_STYLE}  // Map style
            onContextMenu={null}  // Disable right-click context menu if desired
            dragRotate={false}  // Disable rotation if you want a simple map view
            maxPitch={0}  // Disable pitch for a 2D map view
            onError={(err) => this.setState({ mapError: err.error.message })}  // Handle map errors
            ref={this.initMap}
          />
          
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
    allRoutes: 'allRoutes',
  });
  
  export default connect(stateToProps)(withStyles(styles)(AdminView));