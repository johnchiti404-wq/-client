import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, animate, PanInfo } from 'framer-motion';
import { Phone, MessageCircle, MapPin, Star, Package, Home, Navigation } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { db, database } from '../config/firebase';
import { doc, onSnapshot, getDoc, updateDoc } from 'firebase/firestore';
import { ref, onValue } from 'firebase/database';
import { getETA } from '../utils/etaCalculation';

interface OrderItem {
  name: string;
  quantity: number;
  price: number;
  image?: string;
}

interface DriverData {
  name: string;
  rating: number;
  reviewCount?: number;
  vehicleType: string;
  plateNumber: string;
  phone: string;
  photo?: string;
  profileImage?: string;
}

interface StoreData {
  name: string;
  rating: number;
  reviewCount?: number;
  image?: string;
}

interface DriverLocation {
  lat: number;
  lng: number;
}

interface OrderData {
  id?: string;
  storeName?: string;
  storeId?: string;
  storeAddress?: string;
  storeImage?: string;
  items?: OrderItem[];
  subtotal?: number;
  deliveryFee?: number;
  total?: number;
  status?: string;
  driverStatus?: string;
  driverId?: string | null;
  driverLocation?: DriverLocation;
  destinationAddress?: string;
  destinationLocation?: { lat: number; lng: number };
  storeLocation?: { lat: number; lng: number };
  stops?: Array<{ address: string; items?: OrderItem[] }>;
  type?: string;
}

// Panel snap positions (percentage of viewport height)
const PANEL_COLLAPSED = 15; // vh - shows just handle and minimal info
const PANEL_HALF = 45; // vh - shows driver info and some items
const PANEL_EXPANDED = 80; // vh - fully expanded with all items

const SNAP_THRESHOLD = 30; // vh threshold for snapping

const getStatusText = (status: string, stops?: { address: string }[]): string => {
  const statusMessages: Record<string, string> = {
    driver_assigned: 'Driver is on the way to store',
    on_the_way_to_store: 'Driver is on the way to store',
    at_store: 'Driver arrived at store',
    picked_up: 'Order picked up',
    delivering: 'On the way to you',
    at_stop: stops && stops.length > 0 ? `Driver heading to stop` : 'On the way to you',
    delivered: 'Order delivered',
    completed: 'Order delivered',
  };
  return statusMessages[status] || 'Driver is on the way';
};

// Emoji mapping based on rating
const getRatingEmoji = (rating: number): string => {
  if (rating === 0) return '';
  if (rating === 1) return String.fromCodePoint(0x1F61E); // disappointed
  if (rating === 2) return String.fromCodePoint(0x1F615); // confused
  if (rating === 3) return String.fromCodePoint(0x1F610); // neutral
  if (rating === 4) return String.fromCodePoint(0x1F60A); // smiling
  return String.fromCodePoint(0x1F929); // star-struck for 5 stars
};

export const LiveTrackingPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { orderId, orderData: initialOrderData } = location.state || {};

  const [orderData, setOrderData] = useState<OrderData>(initialOrderData || {});
  const [driverData, setDriverData] = useState<DriverData | null>(null);
  const [storeData, setStoreData] = useState<StoreData | null>(null);
  const [driverLocation, setDriverLocation] = useState<DriverLocation | null>(null);
  const [eta, setEta] = useState<string>('Calculating...');
  const [statusText, setStatusText] = useState<string>('Driver is on the way');
  
  // Rating modal states
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [ratingStep, setRatingStep] = useState<'store' | 'driver'>('store');
  const [storeRating, setStoreRating] = useState(0);
  const [driverRating, setDriverRating] = useState(0);
  const [storeComment, setStoreComment] = useState('');
  const [driverComment, setDriverComment] = useState('');
  const [selectedStoreChips, setSelectedStoreChips] = useState<string[]>([]);
  const [selectedDriverChips, setSelectedDriverChips] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Panel drag state
  const panelHeight = useMotionValue(PANEL_COLLAPSED);
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [isScrolling, setIsScrolling] = useState(false);
  const [canDrag, setCanDrag] = useState(true);

  const driverListenerRef = useRef<(() => void) | null>(null);
  const realtimeListenerRef = useRef<(() => void) | null>(null);

  // Store rating chips
  const storeChips = ['Packaging', 'Item Quality', 'Preparation Time'];
  // Driver rating chips
  const driverChips = ['Friendly', 'Fast Delivery', 'Careful Handling', 'Professional'];

  // Transform panel height to border radius
  const borderRadius = useTransform(panelHeight, [PANEL_COLLAPSED, PANEL_EXPANDED], [24, 12]);

  // Handle panel drag
  const handlePanelDrag = useCallback((_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (!canDrag) return;
    
    const currentHeight = panelHeight.get();
    const deltaVh = (-info.delta.y / window.innerHeight) * 100;
    const newHeight = Math.max(PANEL_COLLAPSED, Math.min(PANEL_EXPANDED, currentHeight + deltaVh));
    panelHeight.set(newHeight);
  }, [canDrag, panelHeight]);

  // Handle drag end - snap to nearest position
  const handleDragEnd = useCallback((_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (!canDrag) return;

    const currentHeight = panelHeight.get();
    const velocity = -info.velocity.y;
    
    let targetHeight: number;
    
    // Use velocity to determine direction
    if (Math.abs(velocity) > 500) {
      if (velocity > 0) {
        // Swiping up
        targetHeight = currentHeight < PANEL_HALF ? PANEL_HALF : PANEL_EXPANDED;
      } else {
        // Swiping down
        targetHeight = currentHeight > PANEL_HALF ? PANEL_HALF : PANEL_COLLAPSED;
      }
    } else {
      // Snap to nearest
      if (currentHeight < SNAP_THRESHOLD) {
        targetHeight = PANEL_COLLAPSED;
      } else if (currentHeight < (PANEL_HALF + PANEL_EXPANDED) / 2) {
        targetHeight = PANEL_HALF;
      } else {
        targetHeight = PANEL_EXPANDED;
      }
    }

    animate(panelHeight, targetHeight, {
      type: 'spring',
      stiffness: 300,
      damping: 30,
    });
  }, [canDrag, panelHeight]);

  // Handle scroll interaction
  const handleScroll = useCallback(() => {
    if (contentRef.current) {
      const scrollTop = contentRef.current.scrollTop;
      // Only allow panel drag when scrolled to top
      setCanDrag(scrollTop <= 0);
    }
  }, []);

  // Listen to order document in real-time
  useEffect(() => {
    if (!orderId) return;

    const orderRef = doc(db, 'orders', orderId);
    const unsubscribe = onSnapshot(orderRef, async (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as OrderData;
        setOrderData({ ...data, id: orderId });
        setStatusText(getStatusText(data.status || 'driver_assigned', data.stops));

        // Update driver location from order document
        if (data.driverLocation) {
          setDriverLocation(data.driverLocation);
        }

        // Fetch driver data if driverId exists and we don't have it yet
        if (data.driverId && !driverData) {
          try {
            const driverRef = doc(db, 'drivers', data.driverId);
            const driverSnap = await getDoc(driverRef);
            if (driverSnap.exists()) {
              const dData = driverSnap.data();
              setDriverData({
                name: dData.name || 'Driver',
                rating: dData.rating || 0,
                reviewCount: dData.reviewCount || 0,
                vehicleType: dData.vehicleType || 'Vehicle',
                plateNumber: dData.plateNumber || 'Unknown',
                phone: dData.phone || '',
                photo: dData.photo || dData.profileImage,
                profileImage: dData.profileImage,
              });
            }
          } catch (error) {
            console.error('Error fetching driver data:', error);
          }
        }

        // Fetch store data if storeId exists
        if (data.storeId && !storeData) {
          try {
            const storeRef = doc(db, 'stores', data.storeId);
            const storeSnap = await getDoc(storeRef);
            if (storeSnap.exists()) {
              const sData = storeSnap.data();
              setStoreData({
                name: sData.name || data.storeName || 'Store',
                rating: sData.rating || 0,
                reviewCount: sData.reviewCount || 0,
                image: sData.image || sData.profileImage,
              });
            }
          } catch (error) {
            console.error('Error fetching store data:', error);
          }
        }

        // Handle completed/delivered status - show rating modal
        if (data.status === 'delivered' || data.status === 'completed') {
          setEta('Arrived');
          // Small delay before showing rating modal
          setTimeout(() => {
            setShowRatingModal(true);
            setRatingStep('store');
          }, 1500);
        }
      }
    });

    return () => unsubscribe();
  }, [orderId, driverData, storeData]);

  // Listen to driver document for real-time location updates
  useEffect(() => {
    if (!orderData.driverId) return;

    const driverRef = doc(db, 'drivers', orderData.driverId);
    const unsubscribe = onSnapshot(driverRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.location) {
          setDriverLocation({
            lat: data.location.lat || data.location.latitude,
            lng: data.location.lng || data.location.longitude,
          });
        }
        // Update driver data
        setDriverData({
          name: data.name || 'Driver',
          rating: data.rating || 0,
          reviewCount: data.reviewCount || 0,
          vehicleType: data.vehicleType || data.carModel || 'Vehicle',
          plateNumber: data.plateNumber || 'Unknown',
          phone: data.phone || '',
          photo: data.photo || data.profileImage,
          profileImage: data.profileImage,
        });
      }
    });

    driverListenerRef.current = unsubscribe;

    return () => {
      if (driverListenerRef.current) {
        driverListenerRef.current();
      }
    };
  }, [orderData.driverId]);

  // Listen to Realtime Database for driver location
  useEffect(() => {
    if (!orderData.driverId) return;

    const driverLocationRef = ref(database, `driver_locations/${orderData.driverId}`);
    const unsubscribe = onValue(driverLocationRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        // Realtime DB format: g (geohash), l[0] (lat), l[1] (lng)
        if (data.l && Array.isArray(data.l)) {
          setDriverLocation({
            lat: data.l[0],
            lng: data.l[1],
          });
        }
      }
    });

    realtimeListenerRef.current = unsubscribe;

    return () => {
      if (realtimeListenerRef.current) {
        realtimeListenerRef.current();
      }
    };
  }, [orderData.driverId]);

  // Calculate ETA based on driver location
  useEffect(() => {
    if (!driverLocation) return;

    // Determine target location based on order status
    let targetLat: number;
    let targetLng: number;

    if (orderData.status === 'on_the_way_to_store' || orderData.status === 'driver_assigned') {
      // Target is store location
      targetLat = orderData.storeLocation?.lat || -26.2041;
      targetLng = orderData.storeLocation?.lng || 28.0473;
    } else {
      // Target is destination
      targetLat = orderData.destinationLocation?.lat || -26.195;
      targetLng = orderData.destinationLocation?.lng || 28.04;
    }

    const etaString = getETA(driverLocation.lat, driverLocation.lng, targetLat, targetLng);
    setEta(etaString);
  }, [driverLocation, orderData.status, orderData.storeLocation, orderData.destinationLocation]);

  // Handle store rating submission
  const handleStoreRatingNext = async () => {
    if (storeRating === 0) return;
    setIsSubmitting(true);

    try {
      // Update store rating in Firestore
      if (orderData.storeId) {
        const storeRef = doc(db, 'stores', orderData.storeId);
        const storeSnap = await getDoc(storeRef);
        
        if (storeSnap.exists()) {
          const currentData = storeSnap.data();
          const currentRating = currentData.rating || 0;
          const currentReviewCount = currentData.reviewCount || 0;
          
          // Calculate new average rating
          const newRating = (currentRating * currentReviewCount + storeRating) / (currentReviewCount + 1);
          
          await updateDoc(storeRef, {
            rating: newRating,
            reviewCount: currentReviewCount + 1,
          });
        }
      }
      
      // Move to driver rating step
      setRatingStep('driver');
    } catch (error) {
      console.error('Error submitting store rating:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle driver rating submission
  const handleDriverRatingSubmit = async () => {
    if (driverRating === 0) return;
    setIsSubmitting(true);

    try {
      // Update driver rating in Firestore
      if (orderData.driverId) {
        const driverRef = doc(db, 'drivers', orderData.driverId);
        const driverSnap = await getDoc(driverRef);
        
        if (driverSnap.exists()) {
          const currentData = driverSnap.data();
          const currentRating = currentData.rating || 0;
          const currentReviewCount = currentData.reviewCount || 0;
          
          // Calculate new average rating
          const newRating = (currentRating * currentReviewCount + driverRating) / (currentReviewCount + 1);
          
          await updateDoc(driverRef, {
            rating: newRating,
            reviewCount: currentReviewCount + 1,
          });
        }
      }
      
      // Close modal and navigate home
      setShowRatingModal(false);
      navigate('/', { replace: true });
    } catch (error) {
      console.error('Error submitting driver rating:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCall = () => {
    if (driverData?.phone) {
      window.location.href = `tel:${driverData.phone}`;
    }
  };

  const handleMessage = () => {
    console.log('Open messaging');
  };

  const toggleChip = (chip: string, type: 'store' | 'driver') => {
    if (type === 'store') {
      setSelectedStoreChips(prev => 
        prev.includes(chip) ? prev.filter(c => c !== chip) : [...prev, chip]
      );
    } else {
      setSelectedDriverChips(prev => 
        prev.includes(chip) ? prev.filter(c => c !== chip) : [...prev, chip]
      );
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 relative overflow-hidden">
      {/* Map Placeholder Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-amber-50 via-green-50 to-blue-50">
        {/* Map placeholder with roads pattern */}
        <div className="absolute inset-0 opacity-40">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="map-grid" width="100" height="100" patternUnits="userSpaceOnUse">
                <path d="M 100 0 L 0 0 0 100" fill="none" stroke="#d1d5db" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#map-grid)" />
          </svg>
        </div>

        {/* Simulated roads */}
        <div className="absolute inset-0">
          <div className="absolute top-[30%] left-0 right-0 h-4 bg-amber-200/60 transform -rotate-3" />
          <div className="absolute top-[50%] left-0 right-0 h-3 bg-amber-200/50 transform rotate-2" />
          <div className="absolute top-[70%] left-0 right-0 h-4 bg-amber-200/60 transform -rotate-1" />
          <div className="absolute top-0 bottom-0 left-[25%] w-3 bg-amber-200/50 transform rotate-2" />
          <div className="absolute top-0 bottom-0 left-[60%] w-4 bg-amber-200/60 transform -rotate-1" />
          {/* River/water feature */}
          <div className="absolute top-[40%] left-[40%] w-32 h-64 bg-blue-200/40 rounded-full transform rotate-45" />
        </div>

        {/* Store Location Marker */}
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.3, type: 'spring' }}
          className="absolute top-[35%] left-[20%] transform -translate-x-1/2 -translate-y-1/2"
        >
          <div className="relative">
            <div className="w-12 h-12 bg-red-500 rounded-xl flex items-center justify-center shadow-lg">
              <Package size={24} className="text-white" />
            </div>
            <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-[8px] border-r-[8px] border-t-[10px] border-l-transparent border-r-transparent border-t-red-500" />
          </div>
        </motion.div>

        {/* Driver Location Marker (Car) */}
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.5, type: 'spring' }}
          className="absolute top-[50%] left-[45%] transform -translate-x-1/2 -translate-y-1/2"
        >
          <motion.div
            animate={{ y: [0, -5, 0] }}
            transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
            className="relative"
          >
            <div className="w-14 h-8 bg-white rounded-lg shadow-lg flex items-center justify-center">
              <Navigation size={20} className="text-blue-600" />
            </div>
          </motion.div>
        </motion.div>

        {/* Destination Location Marker (Home) */}
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.7, type: 'spring' }}
          className="absolute top-[55%] right-[15%] transform translate-x-1/2 -translate-y-1/2"
        >
          <div className="relative">
            <div className="w-12 h-12 bg-green-500 rounded-xl flex items-center justify-center shadow-lg">
              <Home size={24} className="text-white" />
            </div>
            <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-[8px] border-r-[8px] border-t-[10px] border-l-transparent border-r-transparent border-t-green-500" />
          </div>
        </motion.div>

        {/* Route line placeholder */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          <motion.path
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.5, ease: 'easeInOut' }}
            d="M 20% 35% Q 35% 45%, 45% 50% T 85% 55%"
            fill="none"
            stroke="#22c55e"
            strokeWidth="4"
            strokeDasharray="8 8"
            className="opacity-60"
          />
        </svg>
      </div>

      {/* Top Status Panel */}
      <motion.div
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="absolute top-4 left-4 right-4 z-20"
      >
        <div className="bg-white rounded-2xl shadow-xl p-4">
          <motion.h2
            key={statusText}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-lg font-bold text-gray-900"
          >
            {statusText}
          </motion.h2>
          <motion.p
            key={eta}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-gray-600 mt-1"
          >
            Driver arriving in <span className="font-semibold text-green-600">{eta}</span>
          </motion.p>
        </div>
      </motion.div>

      {/* Fixed Delivery Address Panel - stays at bottom */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 z-10">
        <div className="flex items-start space-x-3">
          <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
            <MapPin size={16} className="text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Delivery Address</p>
            <p className="text-gray-900 text-sm mt-0.5 truncate">
              {orderData.destinationAddress || 'Address not specified'}
            </p>
          </div>
        </div>
      </div>

      {/* Draggable Bottom Panel */}
      <motion.div
        ref={panelRef}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.1}
        onDrag={handlePanelDrag}
        onDragEnd={handleDragEnd}
        style={{
          height: useTransform(panelHeight, (v) => `${v}vh`),
          borderTopLeftRadius: borderRadius,
          borderTopRightRadius: borderRadius,
        }}
        className="fixed left-0 right-0 bg-white shadow-2xl z-20"
        initial={{ bottom: 60 }}
        animate={{ bottom: 60 }}
      >
        {/* Panel Handle */}
        <div className="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing">
          <div className="w-10 h-1.5 bg-gray-300 rounded-full shadow-sm" />
        </div>

        {/* Panel Content */}
        <div
          ref={contentRef}
          onScroll={handleScroll}
          className="px-4 pb-4 overflow-y-auto"
          style={{ maxHeight: 'calc(100% - 24px)' }}
        >
          {/* Driver Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 }}
            className="flex items-center justify-between py-3 border-b border-gray-100"
          >
            <div className="flex items-center space-x-3">
              {/* Driver Photo */}
              <div className="relative">
                {driverData?.photo || driverData?.profileImage ? (
                  <img
                    src={driverData.photo || driverData.profileImage}
                    alt={driverData.name}
                    className="w-12 h-12 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-12 h-12 bg-gradient-to-br from-amber-400 to-orange-500 rounded-full flex items-center justify-center text-xl font-bold text-white">
                    {driverData?.name?.charAt(0) || '?'}
                  </div>
                )}
              </div>

              {/* Driver Info */}
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <h3 className="font-bold text-base text-gray-900">{driverData?.name || 'Driver'}</h3>
                  {/* Vehicle icon */}
                  <span className="text-gray-400">
                    <Navigation size={16} />
                  </span>
                </div>
                <div className="flex items-center space-x-1 mt-0.5">
                  <Star size={12} className="text-amber-500 fill-amber-500" />
                  <span className="text-xs font-medium text-gray-600">
                    {driverData?.rating?.toFixed(1) || '0.0'}
                  </span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex space-x-2">
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={handleMessage}
                className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center"
              >
                <MessageCircle size={18} className="text-gray-600" />
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={handleCall}
                className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center"
              >
                <Phone size={18} className="text-white" />
              </motion.button>
            </div>
          </motion.div>

          {/* Order Items List */}
          <div className="mt-4">
            <h4 className="text-sm font-semibold text-gray-700 mb-3">Order Items</h4>
            <div className="space-y-3">
              {orderData.items && orderData.items.length > 0 ? (
                orderData.items.map((item, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 * index }}
                    className="flex items-center space-x-3 bg-gray-50 rounded-xl p-3"
                  >
                    {item.image ? (
                      <img
                        src={item.image}
                        alt={item.name}
                        className="w-14 h-14 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="w-14 h-14 bg-gray-200 rounded-lg flex items-center justify-center">
                        <Package size={20} className="text-gray-400" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 text-sm truncate">{item.name}</p>
                      <p className="text-xs text-gray-500">Qty: {item.quantity}</p>
                    </div>
                    <p className="font-semibold text-gray-900 text-sm">
                      R {(item.price * item.quantity).toFixed(2)}
                    </p>
                  </motion.div>
                ))
              ) : (
                <p className="text-gray-500 text-sm text-center py-4">No items</p>
              )}
            </div>
          </div>

          {/* Order Total */}
          <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600">Subtotal</span>
              <span className="text-gray-900">R {orderData.subtotal?.toFixed(2) || '0.00'}</span>
            </div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-600">Delivery Fee</span>
              <span className="text-gray-900">R {orderData.deliveryFee?.toFixed(2) || '0.00'}</span>
            </div>
            <div className="flex justify-between font-bold">
              <span className="text-gray-900">Total</span>
              <span className="text-gray-900">R {orderData.total?.toFixed(2) || '0.00'}</span>
            </div>
          </div>

          {/* Stops if any */}
          {orderData.stops && orderData.stops.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Delivery Stops</h4>
              {orderData.stops.map((stop, index) => (
                <div
                  key={index}
                  className="flex items-center space-x-3 bg-orange-50 rounded-xl p-3 mb-2"
                >
                  <div className="w-6 h-6 bg-orange-200 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-orange-700">{index + 1}</span>
                  </div>
                  <p className="text-gray-700 text-sm">{stop.address}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>

      {/* Rating Modal */}
      <AnimatePresence>
        {showRatingModal && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
            />

            {/* Rating Panel */}
            <motion.div
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 100 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed inset-x-4 bottom-4 top-auto bg-white rounded-3xl shadow-2xl z-50 overflow-hidden"
              style={{ maxHeight: '85vh' }}
            >
              {ratingStep === 'store' ? (
                /* Store Rating Panel */
                <div className="p-6 flex flex-col h-full">
                  <p className="text-center text-gray-500 text-sm mb-4">Rate your store experience</p>
                  
                  {/* Store Info */}
                  <div className="flex items-center space-x-3 pb-4 border-b border-gray-100">
                    {storeData?.image || orderData.storeImage ? (
                      <img
                        src={storeData?.image || orderData.storeImage}
                        alt={storeData?.name || orderData.storeName}
                        className="w-12 h-12 rounded-xl object-cover"
                      />
                    ) : (
                      <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-blue-600 rounded-xl flex items-center justify-center text-xl">
                        <Package size={24} className="text-white" />
                      </div>
                    )}
                    <h3 className="font-bold text-lg text-gray-900">
                      {storeData?.name || orderData.storeName || 'Store'}
                    </h3>
                  </div>

                  {/* Rating Question */}
                  <div className="py-6 text-center">
                    <h2 className="text-xl font-bold text-gray-900 mb-4">
                      How was your experience with the store?
                    </h2>
                    
                    {/* Stars */}
                    <div className="flex justify-center space-x-2 mb-3">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <motion.button
                          key={star}
                          onClick={() => setStoreRating(star)}
                          whileTap={{ scale: 0.9 }}
                          whileHover={{ scale: 1.1 }}
                          className="focus:outline-none"
                        >
                          <Star
                            size={40}
                            className={`transition-colors ${
                              star <= storeRating
                                ? 'fill-yellow-400 text-yellow-400'
                                : 'text-gray-300'
                            }`}
                          />
                        </motion.button>
                      ))}
                    </div>
                    
                    {/* Emoji feedback */}
                    {storeRating > 0 && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="text-4xl mb-4"
                      >
                        {getRatingEmoji(storeRating)}
                      </motion.div>
                    )}
                  </div>

                  {/* Comment Field */}
                  <div className="mb-4">
                    <input
                      type="text"
                      value={storeComment}
                      onChange={(e) => setStoreComment(e.target.value)}
                      placeholder="Leave a note about the store (optional)"
                      className="w-full px-4 py-3 bg-gray-100 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {/* Chips */}
                  <div className="flex flex-wrap gap-2 mb-6">
                    {storeChips.map((chip) => (
                      <button
                        key={chip}
                        onClick={() => toggleChip(chip, 'store')}
                        className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
                          selectedStoreChips.includes(chip)
                            ? 'bg-blue-500 text-white border-blue-500'
                            : 'bg-white text-gray-700 border-gray-300'
                        }`}
                      >
                        {selectedStoreChips.includes(chip) && (
                          <span className="inline-block w-2 h-2 bg-white rounded-full mr-2" />
                        )}
                        {chip}
                      </button>
                    ))}
                  </div>

                  {/* Next Button - Purple gradient */}
                  <button
                    onClick={handleStoreRatingNext}
                    disabled={storeRating === 0 || isSubmitting}
                    className={`w-full py-4 rounded-full font-bold text-lg text-white transition-all ${
                      storeRating === 0 || isSubmitting
                        ? 'bg-gray-300 cursor-not-allowed'
                        : 'bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 shadow-lg'
                    }`}
                  >
                    {isSubmitting ? 'Submitting...' : 'Next'}
                  </button>
                </div>
              ) : (
                /* Driver Rating Panel */
                <div className="p-6 flex flex-col h-full">
                  <p className="text-center text-gray-500 text-sm mb-4">Rate your delivery</p>
                  
                  {/* Driver Info */}
                  <div className="flex items-center justify-center space-x-3 pb-4 border-b border-gray-100">
                    {driverData?.photo || driverData?.profileImage ? (
                      <img
                        src={driverData.photo || driverData.profileImage}
                        alt={driverData.name}
                        className="w-14 h-14 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-14 h-14 bg-gradient-to-br from-amber-400 to-orange-500 rounded-full flex items-center justify-center text-2xl font-bold text-white">
                        {driverData?.name?.charAt(0) || '?'}
                      </div>
                    )}
                    <div className="flex items-center space-x-2">
                      <h3 className="font-bold text-lg text-gray-900">
                        {driverData?.name || 'Driver'}
                      </h3>
                      <Navigation size={18} className="text-gray-400" />
                    </div>
                  </div>

                  {/* Rating Question */}
                  <div className="py-6 text-center">
                    <h2 className="text-xl font-bold text-gray-900 mb-4">
                      How was your delivery?
                    </h2>
                    
                    {/* Stars */}
                    <div className="flex justify-center space-x-2 mb-3">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <motion.button
                          key={star}
                          onClick={() => setDriverRating(star)}
                          whileTap={{ scale: 0.9 }}
                          whileHover={{ scale: 1.1 }}
                          className="focus:outline-none"
                        >
                          <Star
                            size={40}
                            className={`transition-colors ${
                              star <= driverRating
                                ? 'fill-yellow-400 text-yellow-400'
                                : 'text-gray-300'
                            }`}
                          />
                        </motion.button>
                      ))}
                    </div>
                    
                    {/* Emoji feedback */}
                    {driverRating > 0 && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="text-4xl mb-4"
                      >
                        {getRatingEmoji(driverRating)}
                      </motion.div>
                    )}
                  </div>

                  {/* Comment Field */}
                  <div className="mb-4">
                    <input
                      type="text"
                      value={driverComment}
                      onChange={(e) => setDriverComment(e.target.value)}
                      placeholder="Leave a note for the driver (optional)"
                      className="w-full px-4 py-3 bg-gray-100 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>

                  {/* Chips */}
                  <div className="flex flex-wrap gap-2 mb-6">
                    {driverChips.map((chip) => (
                      <button
                        key={chip}
                        onClick={() => toggleChip(chip, 'driver')}
                        className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
                          selectedDriverChips.includes(chip)
                            ? 'bg-gray-800 text-white border-gray-800'
                            : 'bg-white text-gray-700 border-gray-300'
                        }`}
                      >
                        {chip}
                      </button>
                    ))}
                  </div>

                  {/* Submit Button - Green gradient */}
                  <button
                    onClick={handleDriverRatingSubmit}
                    disabled={driverRating === 0 || isSubmitting}
                    className={`w-full py-4 rounded-full font-bold text-lg text-white transition-all ${
                      driverRating === 0 || isSubmitting
                        ? 'bg-gray-300 cursor-not-allowed'
                        : 'bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 shadow-lg'
                    }`}
                  >
                    {isSubmitting ? 'Submitting...' : 'Submit Rating'}
                  </button>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
