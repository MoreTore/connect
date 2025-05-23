import { push } from 'connected-react-router';
import * as Sentry from '@sentry/react';
import document from 'global/document';
import { athena as Athena, billing as Billing, devices as Devices, drives as Drives } from '@moretore/api';
import MyCommaAuth from '@moretore/my-comma-auth';

import * as Types from './types';
import { resetPlayback, selectLoop } from '../timeline/playback';
import { getSegmentFetchRange, hasRoutesData } from '../timeline/segments';
import { getDeviceFromState, deviceVersionAtLeast } from '../utils';

let routesRequest = null;

function updateTimeline(state, dispatch, start, end, allowPathChange) {
  dispatch(checkRoutesData());

  if (!state.loop || !state.loop.startTime || !state.loop.duration || state.loop.startTime < start
    || state.loop.startTime + state.loop.duration > end || state.loop.duration < end - start) {
    dispatch(resetPlayback());
    dispatch(selectLoop(start, end));
  }

  if (allowPathChange) {
    const desiredPath = urlForState(state.dongleId, start, end, false);
    if (window.location.pathname !== desiredPath) {
      dispatch(push(desiredPath));
    }
  }
}

export function popTimelineRange(allowPathChange = true) {
  return (dispatch, getState) => {
    const state = getState();
    if (state.zoom.previous) {
      dispatch({
        type: Types.TIMELINE_POP_SELECTION,
      });

      const { start, end } = state.zoom.previous;
      updateTimeline(state, dispatch, start, end, allowPathChange);
    }
  };
}

export function pushTimelineRange(start, end, allowPathChange = true) {
  return (dispatch, getState) => {
    const state = getState();
    if (state.zoom?.start !== start || state.zoom?.end !== end) {
      dispatch({
        type: Types.TIMELINE_PUSH_SELECTION,
        start,
        end,
      });
    }

    updateTimeline(state, dispatch, start, end, allowPathChange);
  };
}

export function selectDevice(dongleId, allowPathChange = true) {
  return (dispatch, getState) => {
    const state = getState();
    let device;
    if (state.devices && state.devices.length > 1) {
      device = state.devices.find((d) => d.dongle_id === dongleId);
    }
    if (!device && state.device && state.device.dongle_id === dongleId) {
      device = state.device;
    }

    dispatch({
      type: Types.ACTION_SELECT_DEVICE,
      dongleId,
    });

    dispatch(pushTimelineRange(null, null, false));
    if ((device && !device.shared) || state.profile?.superuser) {
      dispatch(primeFetchSubscription(dongleId, device));
      dispatch(fetchDeviceOnline(dongleId));
    }

    dispatch(checkRoutesData());

    if (allowPathChange) {
      const desiredPath = urlForState(dongleId, null, null, null);
      if (window.location.pathname !== desiredPath) {
        dispatch(push(desiredPath));
      }
    }
  };
}

export function primeFetchSubscription(dongleId, device, profile) {
  return (dispatch, getState) => {
    const state = getState();

    if (!device && state.device && state.device === dongleId) {
      device = state.device;
    }
    if (!profile && state.profile) {
      profile = state.profile;
    }

    if (device && (device.is_owner || profile.superuser)) {
      if (device.prime) {
        Billing.getSubscription(dongleId).then((subscription) => {
          dispatch(primeGetSubscription(dongleId, subscription));
        }).catch((err) => {
          console.error(err);
          Sentry.captureException(err, { fingerprint: 'actions_fetch_subscription' });
        });
      } else {
        Billing.getSubscribeInfo(dongleId).then((subscribeInfo) => {
          dispatch({
            type: Types.ACTION_PRIME_SUBSCRIBE_INFO,
            dongleId,
            subscribeInfo,
          });
        }).catch((err) => {
          console.error(err);
          Sentry.captureException(err, { fingerprint: 'actions_fetch_subscribe_info' });
        });
      }
    }
  };
}

export function primeNav(nav, allowPathChange = true) {
  return (dispatch, getState) => {
    const state = getState();
    if (!state.dongleId) {
      return;
    }

    if (state.primeNav !== nav) {
      dispatch({
        type: Types.ACTION_PRIME_NAV,
        primeNav: nav,
      });
    }

    if (allowPathChange) {
      const curPath = document.location.pathname;
      const desiredPath = urlForState(state.dongleId, null, null, nav);
      if (curPath !== desiredPath) {
        dispatch(push(desiredPath));
      }
    }
  };
}

export function fetchSharedDevice(dongleId) {
  return async (dispatch) => {
    try {
      const resp = await Devices.fetchDevice(dongleId);
      dispatch({
        type: Types.ACTION_UPDATE_SHARED_DEVICE,
        dongleId,
        device: resp,
      });
    } catch (err) {
      if (!err.resp || err.resp.status !== 403) {
        console.error(err);
        Sentry.captureException(err, { fingerprint: 'action_fetch_shared_device' });
      }
    }
  };
}

export function fetchDeviceOnline(dongleId) {
  return (dispatch) => {
    Devices.fetchDevice(dongleId).then((resp) => {
      dispatch({
        type: Types.ACTION_UPDATE_DEVICE_ONLINE,
        dongleId,
        last_athena_ping: resp.last_athena_ping,
        fetched_at: Math.floor(Date.now() / 1000),
      });
    }).catch(console.log);
  };
}

export function updateDeviceOnline(dongleId, lastAthenaPing) {
  return (dispatch) => {
    dispatch({
      type: Types.ACTION_UPDATE_DEVICE_ONLINE,
      dongleId,
      last_athena_ping: lastAthenaPing,
      fetched_at: Math.floor(Date.now() / 1000),
    });
  };
}

export function fetchDeviceNetworkStatus(dongleId) {
  return async (dispatch, getState) => {
    const device = getDeviceFromState(getState(), dongleId);
    if (deviceVersionAtLeast(device, '0.8.14')) {
      const payload = {
        id: 0,
        jsonrpc: '2.0',
        method: 'getNetworkMetered',
      };
      try {
        const resp = await Athena.postJsonRpcPayload(dongleId, payload);
        if (resp && resp.result !== undefined) {
          dispatch({
            type: Types.ACTION_UPDATE_DEVICE_NETWORK,
            dongleId,
            networkMetered: resp.result,
          });
          dispatch(updateDeviceOnline(dongleId, Math.floor(Date.now() / 1000)));
        }
      } catch (err) {
        if (err.message && (err.message.indexOf('Timed out') === -1 || err.message.indexOf('Device not registered') === -1)) {
          dispatch(updateDeviceOnline(dongleId, 0));
        } else {
          console.error(err);
          Sentry.captureException(err, { fingerprint: 'athena_fetch_networkmetered' });
        }
      }
    } else {
      const payload = {
        id: 0,
        jsonrpc: '2.0',
        method: 'getNetworkType',
      };
      try {
        const resp = await Athena.postJsonRpcPayload(dongleId, payload);
        if (resp && resp.result !== undefined) {
          const metered = resp.result !== 1 && resp.result !== 6; // wifi or ethernet
          dispatch({
            type: Types.ACTION_UPDATE_DEVICE_NETWORK,
            dongleId,
            networkMetered: metered,
          });
          dispatch(updateDeviceOnline(dongleId, Math.floor(Date.now() / 1000)));
        }
      } catch (err) {
        if (err.message && (err.message.indexOf('Timed out') === -1 || err.message.indexOf('Device not registered') === -1)) {
          dispatch(updateDeviceOnline(dongleId, 0));
        } else {
          console.error(err);
          Sentry.captureException(err, { fingerprint: 'athena_fetch_networktype' });
        }
      }
    }
  };
}

export function checkAllRoutesData(dongleIds) {
  return (dispatch, getState) => {
    if (!dongleIds || dongleIds.length === 0) {
      return;
    }

    const state = getState();
    const fetchRange = getSegmentFetchRange(state); // Assuming a common fetch range for simplicity
    // Create an array of promises to fetch routes for each dongleId
    const routesRequests = dongleIds.map((dongleId) => {
      return Drives.getRoutesSegments(dongleId, fetchRange.start, fetchRange.end)
        .then((routesData) => {
          // Process routesData for this device
          const routes = routesData.map((r) => {
            let startTime = r.segment_start_times[0];
            let endTime = r.segment_end_times[r.segment_end_times.length - 1];

            // Adjust segment boundary times if necessary (same logic as before)
            if ((Math.abs(r.start_time_utc_millis - startTime) > 24 * 60 * 60 * 1000)
              && (Math.abs(r.end_time_utc_millis - endTime) < 10 * 1000)) {
              console.log('fixing %s', r.fullname);
              startTime = r.start_time_utc_millis;
              endTime = r.end_time_utc_millis;
              r.segment_start_times = r.segment_numbers.map((x) => startTime + (x * 60 * 1000));
              r.segment_end_times = r.segment_numbers.map((x) => Math.min(startTime + ((x + 1) * 60 * 1000), endTime));
            }

            return {
              ...r,
              dongleId, // Add dongleId to identify which device this route belongs to
              url: r.url.replace('chffrprivate.blob.core.windows.net', 'chffrprivate.azureedge.net'),
              offset: Math.round(startTime) - state.filter.start,
              duration: endTime - startTime,
              start_time_utc_millis: startTime,
              end_time_utc_millis: endTime,
              segment_offsets: r.segment_start_times.map((x) => x - state.filter.start),
            };
          });

          return routes;
        })
        .catch((err) => {
          console.error(`Failure fetching routes metadata for dongleId ${dongleId}`, err);
          // Return an empty array in case of error to prevent breaking Promise.all
          return [];
        });
    });

    // Wait for all routes data to be fetched
    Promise.all(routesRequests).then((allRoutesArrays) => {
      // Flatten the array of arrays into a single array of routes
      const allRoutes = allRoutesArrays.flat();

      dispatch({
        type: Types.ACTION_ROUTES_METADATA_ALL,
        start: fetchRange.start,
        end: fetchRange.end,
        allRoutes,
      });
    });
  };
}

export function checkRoutesData() {
  return (dispatch, getState) => {
    let state = getState();
    if (!state.dongleId) {
      return;
    }
    if (hasRoutesData(state)) {
      // already has metadata, don't bother
      return;
    }
    if (routesRequest && routesRequest.dongleId === state.dongleId) {
      return;
    }
    console.debug('We need to update the segment metadata...');
    const { dongleId } = state;
    const fetchRange = getSegmentFetchRange(state);

    routesRequest = {
      req: Drives.getRoutesSegments(dongleId, fetchRange.start, fetchRange.end),
      dongleId,
    };

    routesRequest.req.then((routesData) => {
      state = getState();
      const currentRange = getSegmentFetchRange(state);
      if (currentRange.start !== fetchRange.start
        || currentRange.end !== fetchRange.end
        || state.dongleId !== dongleId) {
        routesRequest = null;
        dispatch(checkRoutesData());
        return;
      }
      if (routesData && routesData.length === 0
        && !MyCommaAuth.isAuthenticated()) {
        window.location = `/?r=${encodeURI(window.location.pathname)}`; // redirect to login
        return;
      }

      const routes = routesData.map((r) => {
        let startTime = r.segment_start_times[0];
        let endTime = r.segment_end_times[r.segment_end_times.length - 1];

        // TODO: these will all be relative times soon
        // fix segment boundary times for routes that have the wrong time at the start
        if ((Math.abs(r.start_time_utc_millis - startTime) > 24 * 60 * 60 * 1000)
            && (Math.abs(r.end_time_utc_millis - endTime) < 10 * 1000)) {
          console.log('fixing %s', r.fullname);
          startTime = r.start_time_utc_millis;
          endTime = r.end_time_utc_millis;
          r.segment_start_times = r.segment_numbers.map((x) => startTime + (x * 60 * 1000));
          r.segment_end_times = r.segment_numbers.map((x) => Math.min(startTime + ((x + 1) * 60 * 1000), endTime));
        }
        return {
          ...r,
          url: r.url.replace('chffrprivate.blob.core.windows.net', 'chffrprivate.azureedge.net'),
          offset: Math.round(startTime) - state.filter.start,
          duration: endTime - startTime,
          start_time_utc_millis: startTime,
          end_time_utc_millis: endTime,
          segment_offsets: r.segment_start_times.map((x) => x - state.filter.start),
        };
      });

      dispatch({
        type: Types.ACTION_ROUTES_METADATA,
        dongleId,
        start: fetchRange.start,
        end: fetchRange.end,
        routes,
      });

      routesRequest = null;
    }).catch((err) => {
      console.error('Failure fetching routes metadata', err);
      Sentry.captureException(err, { fingerprint: 'timeline_fetch_routes' });
      routesRequest = null;
    });
  };
}

export function updateDevices(devices) {
  return {
    type: Types.ACTION_UPDATE_DEVICES,
    devices,
  };
}

export function updateDevice(device) {
  return {
    type: Types.ACTION_UPDATE_DEVICE,
    device,
  };
}

export function selectTimeFilter(start, end) {
  return (dispatch, getState) => {
    dispatch({
      type: Types.ACTION_SELECT_TIME_FILTER,
      start,
      end,
    });

    dispatch(checkRoutesData());
  };
}

export function primeGetSubscription(dongleId, subscription) {
  return {
    type: Types.ACTION_PRIME_SUBSCRIPTION,
    dongleId,
    subscription,
  };
}

export function urlForState(dongleId, start, end, prime) {
  const path = [dongleId];

  if (start && end) {
    path.push(start);
    path.push(end);
  } else if (prime) {
    path.push('prime');
  }

  return `/${path.join('/')}`;
}

export function analyticsEvent(name, parameters) {
  return {
    type: Types.ANALYTICS_EVENT,
    name,
    parameters,
  };
}

export function updateRoute(fullname, route) {
  return {
    type: Types.ACTION_UPDATE_ROUTE,
    fullname,
    route,
  };
}

export function setCurrentView(view) {
  return {
    type: Types.ACTION_SET_CURRENT_VIEW,
    payload: view,
  };
}
