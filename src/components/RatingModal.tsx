import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Star } from 'lucide-react';

// Emoji mapping based on rating - same as delivery rating panel
const getRatingEmoji = (rating: number): string => {
  if (rating === 0) return '';
  if (rating === 1) return String.fromCodePoint(0x1F61E); // disappointed
  if (rating === 2) return String.fromCodePoint(0x1F615); // confused
  if (rating === 3) return String.fromCodePoint(0x1F610); // neutral
  if (rating === 4) return String.fromCodePoint(0x1F60A); // smiling
  return String.fromCodePoint(0x1F929); // star-struck for 5 stars
};

interface RatingModalProps {
  isOpen: boolean;
  onClose: () => void;
  driverName: string;
  driverPhoto: string;
  driverPhotoUrl?: string; // Optional URL for driver profile image from Firestore
  onSubmitRating: (rating: number, feedback: string) => void;
}

export const RatingModal: React.FC<RatingModalProps> = ({
  isOpen,
  onClose,
  driverName,
  driverPhoto,
  driverPhotoUrl,
  onSubmitRating
}) => {
  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (rating === 0) {
      alert('Please select a rating');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmitRating(rating, feedback);
      setRating(0);
      setFeedback('');
      onClose();
    } catch (error) {
      console.error('Error submitting rating:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="fixed inset-0 bg-black bg-opacity-50 z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          {/* Rating Panel - Reduced height, fixed layout structure */}
          <motion.div
            className="fixed inset-x-4 bottom-4 top-auto bg-white rounded-3xl shadow-2xl z-50 overflow-hidden flex flex-col"
            style={{ maxHeight: '70vh' }}
            initial={{ scale: 0.8, y: 50 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.8, y: 50 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          >
            {/* FIXED HEADER */}
            <div className="flex-shrink-0 p-6 pb-4">
              <div className="text-center">
                <motion.div
                  className="w-20 h-20 bg-gradient-to-br from-green-400 to-green-600 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg overflow-hidden"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.2, type: 'spring', damping: 15 }}
                >
                  {driverPhotoUrl ? (
                    <img src={driverPhotoUrl} alt={driverName} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-4xl">{driverPhoto}</span>
                  )}
                </motion.div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">Rate your driver</h2>
                <p className="text-gray-600">How was your experience with {driverName}?</p>
              </div>

              {/* Stars */}
              <div className="flex justify-center space-x-2 mt-4">
                {[1, 2, 3, 4, 5].map((star) => (
                  <motion.button
                    key={star}
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHoveredRating(star)}
                    onMouseLeave={() => setHoveredRating(0)}
                    className="focus:outline-none"
                    whileHover={{ scale: 1.2 }}
                    whileTap={{ scale: 0.9 }}
                  >
                    <Star
                      size={36}
                      className={`transition-colors ${
                        star <= (hoveredRating || rating)
                          ? 'fill-yellow-400 text-yellow-400'
                          : 'text-gray-300'
                      }`}
                    />
                  </motion.button>
                ))}
              </div>

              {/* Emoji feedback - Fixed height container to prevent layout shift */}
              <div className="h-12 flex items-center justify-center mt-2">
                {rating > 0 && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="text-4xl"
                  >
                    {getRatingEmoji(rating)}
                  </motion.div>
                )}
              </div>
            </div>

            {/* SCROLLABLE MIDDLE SECTION */}
            <div className="flex-1 overflow-y-auto px-6">
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Share your experience (optional)"
                className="w-full bg-gray-100 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                rows={3}
              />
            </div>

            {/* FIXED BOTTOM BUTTON */}
            <div className="flex-shrink-0 p-6 pt-4">
              <button
                onClick={handleSubmit}
                disabled={rating === 0 || isSubmitting}
                className={`w-full py-4 rounded-2xl font-semibold text-lg transition-colors ${
                  rating === 0 || isSubmitting
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-green-600 text-white hover:bg-green-700'
                }`}
              >
                {isSubmitting ? 'Submitting...' : 'Submit rating'}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
