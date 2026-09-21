import React, { useState, useEffect, useRef } from 'react';
import { api } from '../../../services/api';
import { useApp } from '../../../context/AppContext';
import Step1Source from './Step1Source';
import Step2FrontScan from './Step2FrontScan';
import Step3BackScan from './Step3BackScan';
import StepParsingAI from './StepParsingAI';
import Step4Details from './Step4Details';
import Step5Photo from './Step5Photo';
import Step6Stay from './Step6Stay';
import Step7Payment from './Step7Payment';
import ImageLightbox from '../../common/ImageLightbox';
import ErrorBoundary from '../../common/ErrorBoundary';
import { printGuestRegistrationA4, printCashReceipt, downloadGuestRegistrationPDF, cleanVoucherNumber } from '../../../services/printService';

export default function CheckinWizardModal({
  isOpen,
  room,
  additionalRooms = [],
  onClose,
  onCheckinSuccess
}) {
  const { showToast, currentUser, surchargeSettings, minCheckinAdvancePct } = useApp();
  const cardPct = surchargeSettings?.card_surcharge_pct !== undefined ? Number(surchargeSettings.card_surcharge_pct) : 2.5;
  const upiPct = surchargeSettings?.upi_tax_pct !== undefined ? Number(surchargeSettings.upi_tax_pct) : 0.4;
  const upiThresh = surchargeSettings?.upi_tax_threshold !== undefined ? Number(surchargeSettings.upi_tax_threshold) : 2000;

  const [currentStep, setCurrentStep] = useState(1);
  const [maxReachedStep, setMaxReachedStep] = useState(1);
  const [lightboxImage, setLightboxImage] = useState(null);
  const [lightboxTitle, setLightboxTitle] = useState('Document Preview');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const modalBodyRef = useRef(null);

  // Smooth scroll to top when changing steps to prevent layout clamping & scroll oscillation
  useEffect(() => {
    if (modalBodyRef.current) {
      modalBodyRef.current.scrollTop = 0;
    }
  }, [currentStep]);

  useEffect(() => {
    const fl = Math.floor(currentStep);
    if (fl > maxReachedStep) {
      setMaxReachedStep(fl);
    }
  }, [currentStep, maxReachedStep]);

  // Multi-room state & available inventory
  const [additionalRoomsList, setAdditionalRoomsList] = useState(additionalRooms || []);
  const [readyRooms, setReadyRooms] = useState([]);

  useEffect(() => {
    setAdditionalRoomsList(additionalRooms || []);
  }, [additionalRooms]);

  useEffect(() => {
    if (isOpen && room) {
      api.getRooms()
        .then((res) => {
          const list = Array.isArray(res) ? res : (res?.rooms || []);
          setReadyRooms(list.filter((r) => r.status === 'ready' && r.id !== room.id));
        })
        .catch((e) => console.warn('Could not fetch ready rooms:', e));
    }
  }, [isOpen, room]);

  const [roomGstPct, setRoomGstPct] = useState(5);

  useEffect(() => {
    if (isOpen) {
      if (room && room.gst_pct !== undefined && room.gst_pct !== null) {
        setRoomGstPct(Number(room.gst_pct) || 0);
      } else {
        api.getRoomGst()
          .then((res) => {
            if (res && res.success && res.room_gst_pct !== undefined) {
              setRoomGstPct(Number(res.room_gst_pct) || 5);
            }
          })
          .catch((err) => console.warn('Could not load room GST:', err));
      }
    }
  }, [isOpen, room]);

  const getTomorrow11AM = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}T11:00`;
  };

  // Initialize Check-in Draft State
  const [draft, setDraft] = useState({
    bookingSource: null,
    otaPlatform: '',
    isPrepaid: null,
    otaVoucherNo: '',
    otaManualAmount: '',
    btcCompanyId: null,
    btcCompanyName: '',
    btcVoucherNo: '',
    docType: 'Aadhar Card',
    docFront: null,
    docBack: null,
    companyName: '',
    gstNumber: '',
    guestName: '',
    fatherName: '',
    mobile: '',
    altMobile: '',
    email: '',
    dob: '',
    expiryDate: '',
    address: '',
    guestPhoto: null,
    adultsMale: 0,
    adultsFemale: 0,
    children: 0,
    hasExtraPersons: false,
    otaBookedAdults: 1,
    otaBookedChildren: 0,
    extraAdults: 0,
    extraChildren: 0,
    extraBeds: 0,
    roomExtraBeds: {},
    checkinTime: new Date().toISOString(),
    approxCheckout: '',
    checkoutDate: '',
    checkoutTime: '',
    extensionCharge: 0,
    stayNights: 1,
    baseRate: room ? room.price : 2000,
    discountPct: 0,
    mealPlan: 'with_breakfast',
    extraMealPlan: 'without_breakfast',
    splitCash: 0,
    splitOnline: 0,
    splitCard: 0,
    splitCheque: 0,
    chequeNo: '',
    chequeBank: '',
    chequeDate: '',
    chequeScan: null,
    memberDocuments: [],
    aadharNumber: ''
  });

  const prevModalStateRef = React.useRef({ isOpen: false, roomId: null });

  useEffect(() => {
    if (isOpen && room) {
      const wasClosed = !prevModalStateRef.current.isOpen || prevModalStateRef.current.roomId !== room.id;
      prevModalStateRef.current = { isOpen: true, roomId: room.id };

      if (wasClosed) {
        setCurrentStep(1);
        setMaxReachedStep(1);
        const initialAllRooms = [room, ...(additionalRooms || [])];
        const initialTariff = initialAllRooms.reduce((sum, r) => sum + (Number(r.price) || 2000), 0);

        setDraft({
          roomId: room.id,
          roomNumber: room.room_number,
          roomType: room.room_type,
          baseRate: initialTariff,
          adultsMale: 0,
          adultsFemale: 0,
          children: 0,
          roomExtraBeds: { [room.id]: 0 },
          extraBeds: 0,
          hasExtraPersons: false,
          otaBookedAdults: 1,
          otaBookedChildren: 0,
          otaBookedExtraBeds: 0,
          extraAdults: 0,
          extraChildren: 0,
          checkinTime: new Date().toISOString(),
          approxCheckout: '',
          checkoutDate: '',
          checkoutTime: '',
          extensionCharge: 0,
          stayNights: 1,
          docType: 'Aadhar Card',
          docFront: null,
          docBack: null,
          guestPhoto: null,
          bookingSource: null,
          isPrepaid: null,
          btcCompanyId: null,
          btcCompanyName: '',
          btcVoucherNo: '',
          otaPlatform: '',
          otaVoucherNo: '',
          otaManualAmount: '',
          isEarlyCheckin: null,
          originalCheckinTime: '',
          earlyCheckinTime: '',
          mealPlan: 'with_breakfast',
          extraMealPlan: 'without_breakfast',
          memberDocuments: [],
          aadharNumber: '',
          guestName: '',
          fatherName: '',
          mobile: '',
          altMobile: '',
          email: '',
          dob: '',
          expiryDate: '',
          address: '',
          splitCash: '',
          splitOnline: '',
          splitCard: '',
          splitCheque: ''
        });
      }
    } else if (!isOpen) {
      prevModalStateRef.current = { isOpen: false, roomId: null };
    }
  }, [isOpen, room]);

  if (!isOpen || !room) return null;

  const updateDraft = (fields) => {
    setDraft((prev) => ({ ...prev, ...fields }));
  };

  // Calculate Total Net Due for Step 6 & 7 (aggregates all allocated rooms)
  const isOta = draft.bookingSource === 'OTA';
  const isBtc = draft.bookingSource === 'BTC';
  const allSelectedRooms = [room, ...(additionalRoomsList || [])];
  const combinedRoomsTariff = allSelectedRooms.reduce((sum, r) => sum + (Number(r.price) || 2000), 0);
  const basePrice = draft.baseRate !== undefined ? Number(draft.baseRate) : combinedRoomsTariff;
  const discountPct = Math.min(Number(draft.discountPct) || 0, room.max_discount_pct || 15);
  const extraBeds = draft.roomExtraBeds !== undefined && Object.keys(draft.roomExtraBeds).length > 0
    ? allSelectedRooms.reduce((sum, r) => {
        return sum + (Number(draft.roomExtraBeds?.[r.id]) || 0);
      }, 0)
    : (Number(draft.extraBeds) || 0);
  const extraBedRate = room.extra_bed_price || 500;
  const breakfastRate = room.breakfast_price || 250;
  const extensionCharge = isOta ? 0 : (Number(draft.extensionCharge) || 0);

  let nights = 1;
  if (draft.checkinTime && (draft.checkoutDate || draft.approxCheckout)) {
    const dInStr = draft.checkinTime.split('T')[0];
    const dOutStr = draft.checkoutDate || draft.approxCheckout.split('T')[0];
    if (dInStr && dOutStr) {
      const dIn = new Date(dInStr);
      const dOut = new Date(dOutStr);
      const diffDays = Math.round((dOut - dIn) / (1000 * 60 * 60 * 24));
      nights = Math.max(1, diffDays);
    }
  }

  const otaExtraAdults = isOta ? (Number(draft.extraAdults) || 0) : 0;
  const otaBookedExtraBeds = Number(draft.otaBookedExtraBeds) || 0;

  const getRoomExtraBedRate = (targetRoom) => {
    if (!targetRoom) return Number(draft.extraBedRate || extraBedRate || 500);
    if (draft.roomExtraBedRates?.[targetRoom.id] !== undefined) {
      return Number(draft.roomExtraBedRates[targetRoom.id]);
    }
    return Number(targetRoom.extra_bed_price || draft.extraBedRate || extraBedRate || 500);
  };

  const extraBedCharge = isOta
    ? (() => {
        let freeVoucherBedsRemaining = otaBookedExtraBeds;
        let totalCharge = 0;
        allSelectedRooms.forEach((r) => {
          const bedsInRoom = Number(draft.roomExtraBeds?.[r.id]) || 0;
          const roomRate = getRoomExtraBedRate(r);
          const freeFromThisRoom = Math.min(freeVoucherBedsRemaining, bedsInRoom);
          freeVoucherBedsRemaining -= freeFromThisRoom;
          const chargeableBeds = bedsInRoom - freeFromThisRoom;
          if (chargeableBeds > 0) {
            totalCharge += chargeableBeds * roomRate * nights;
          }
        });
        if (totalCharge === 0 && otaExtraAdults > 0) {
          totalCharge = otaExtraAdults * (draft.extraBedRate !== undefined ? Number(draft.extraBedRate) : extraBedRate) * nights;
        }
        return totalCharge;
      })()
    : (allSelectedRooms.reduce((sum, r) => {
        const beds = Number(draft.roomExtraBeds?.[r.id]) || 0;
        const rate = getRoomExtraBedRate(r);
        return sum + (beds * rate);
      }, 0) * nights);

  const otaExtraRooms = isOta
    ? (additionalRoomsList || []).filter(r => r._isHotelExtra || draft.otaExtraRoomIds?.includes(r.id))
    : [];
  const extraRoomsCharge = isOta
    ? (otaExtraRooms.reduce((sum, r) => sum + (Number(r.price) || 2000), 0) * nights)
    : 0;

  const extraBreakfastCharge = isOta
    ? (draft.extraMealPlan === 'with_breakfast' ? (otaExtraAdults * breakfastRate * nights) : 0)
    : 0;

  const totalGuests = (Number(draft.adultsMale) || 0) + (Number(draft.adultsFemale) || 0);
  const mealTotalCharge = isOta
    ? extraBreakfastCharge
    : (draft.mealPlan === 'with_breakfast' ? totalGuests * breakfastRate * nights : 0);
  const effectiveDiscountPct = isOta ? 0 : discountPct;

  let totalBaseRate = (basePrice * nights) + extensionCharge + mealTotalCharge + extraBedCharge;
  if (isOta && draft.otaManualAmount) {
    totalBaseRate = (Number(draft.otaManualAmount) || 0) + extraBedCharge + extraRoomsCharge + extraBreakfastCharge + extensionCharge;
  }

  const discountAmount = isOta ? 0 : Math.round((totalBaseRate * effectiveDiscountPct) / 100);
  const netChargeBeforeTax = Math.round(totalBaseRate - discountAmount);
  const isOtaPrepaid = isOta && draft.isPrepaid === true;
  const gstAmount = isOta ? 0 : Math.round(netChargeBeforeTax * (roomGstPct / 100));
  let totalDue = netChargeBeforeTax + gstAmount;
  if (isOta && isOtaPrepaid) {
    totalDue = Math.max(0, extraBedCharge + extraRoomsCharge + extraBreakfastCharge + extensionCharge);
  }

  // Step Nav validation
  const validateStep = (step) => {
    if (step === 1) {
      if (!draft.bookingSource) {
        showToast('Please select a Booking Source / Channel to proceed.', 'red');
        return false;
      }
      if (draft.bookingSource === 'OTA') {
        if (!draft.otaPlatform) {
          showToast('Please select an OTA Platform.', 'red');
          return false;
        }
        if (draft.isPrepaid === null || draft.isPrepaid === undefined) {
          showToast('Please select OTA Payment Collection Mode (Pre-Paid or Pay at Hotel).', 'red');
          return false;
        }
        if (!draft.otaVoucherNo?.trim()) {
          showToast('Please enter OTA Booking ID / Voucher No.', 'red');
          return false;
        }
        if (!draft.otaManualAmount || Number(draft.otaManualAmount) <= 0) {
          showToast('OTA Bill amount is mandatory for OTA bookings.', 'red');
          return false;
        }
      }
      if (draft.bookingSource === 'BTC' && !draft.btcCompanyId) {
        showToast('Please select a verified Corporate BTC Company.', 'red');
        return false;
      }
      return true;
    }
    if (step === 2) {
      if (!draft.docFront) {
        showToast('Please scan or upload the front of the ID card.', 'red');
        return false;
      }
      return true;
    }
    if (step === 4) {
      if (!draft.guestName.trim()) {
        showToast('Guest Full Name is required.', 'red');
        return false;
      }
      if (!draft.mobile || draft.mobile.length !== 10) {
        showToast('Valid 10-digit mobile number is required.', 'red');
        return false;
      }
      if (!draft.email.trim()) {
        showToast('Email address is mandatory.', 'red');
        return false;
      }
      if (!draft.address.trim()) {
        showToast('Complete residential address is required.', 'red');
        return false;
      }
      return true;
    }
    if (step === 5) {
      if (!draft.guestPhoto) {
        showToast('Guest photo is mandatory. Please capture or upload a guest photo.', 'red');
        return false;
      }
      return true;
    }
    if (step === 6) {
      const adultCount = (Number(draft.adultsMale) || 0) + (Number(draft.adultsFemale) || 0);
      if (!isOta && adultCount < 1) {
        showToast('At least 1 adult guest is required to proceed.', 'red');
        return false;
      }
      if (!draft.checkoutDate) {
        showToast('Expected Checkout Date is mandatory. Please select checkout date.', 'red');
        return false;
      }
      if (!isOta && (!draft.checkoutTime || !draft.checkoutTime.trim())) {
        showToast('Expected Checkout Time is mandatory. Please select checkout time.', 'red');
        return false;
      }
      return true;
    }
    return true;
  };

  const handleNext = () => {
    if (!validateStep(currentStep)) return;

    if (currentStep === 1) {
      setCurrentStep(2);
    } else if (currentStep === 2) {
      setCurrentStep(3);
    } else if (currentStep === 3) {
      setCurrentStep(3.5); // AI Vision Parsing screen
    } else if (currentStep === 3.5) {
      setCurrentStep(4);
    } else if (currentStep === 4) {
      setCurrentStep(5);
    } else if (currentStep === 5) {
      setCurrentStep(6);
    } else if (currentStep === 6) {
      setCurrentStep(7);
    } else if (currentStep === 7) {
      handleSubmitCheckin();
    }
  };

  const handlePrev = () => {
    if (currentStep === 3.5) {
      setCurrentStep(3);
    } else if (currentStep > 1) {
      setCurrentStep((prev) => Math.floor(prev) - 1);
    }
  };

  const handleManualEntry = () => {
    if (!draft.bookingSource) {
      showToast('Please select a Booking Source / Channel first to proceed.', 'red');
      return;
    }
    if (draft.bookingSource === 'BTC' && !draft.btcCompanyId) {
      showToast('Please select or verify a Corporate BTC Company first.', 'red');
      return;
    }
    setCurrentStep(4);
  };

  const handleSkipBack = () => {
    setCurrentStep(3.5);
  };

  const openLightbox = (url, title) => {
    setLightboxImage(url);
    setLightboxTitle(title || 'Document Preview');
  };

  const handleSubmitCheckin = async () => {
    const totalPaid =
      (Number(draft.splitCash) || 0) +
      (Number(draft.splitOnline) || 0) +
      (Number(draft.splitCard) || 0) +
      (Number(draft.splitCheque) || 0);

    const allowedTotalCharge = (isOta && isOtaPrepaid) ? Math.max(totalDue, totalPaid) : totalDue;

    if (!isOtaPrepaid && totalPaid > allowedTotalCharge) {
      showToast(`Advance payment cannot exceed total stay bill of ₹${allowedTotalCharge.toLocaleString('en-IN')}`, 'red');
      return;
    }

    if (!draft.guestPhoto) {
      showToast('Guest photo is mandatory. Please capture or upload a guest photo.', 'red');
      setCurrentStep(5);
      return;
    }

    const minPct = Number(minCheckinAdvancePct !== undefined ? minCheckinAdvancePct : 50);
    if (!isOta && !isBtc && minPct > 0) {
      const minRequired = Math.ceil((totalDue * minPct) / 100);
      if (totalPaid < minRequired) {
        showToast(
          `Minimum ${minPct}% advance payment (₹${minRequired.toLocaleString('en-IN')}) is required at check-in. Current advance: ₹${totalPaid.toLocaleString('en-IN')}.`,
          'red',
          5000
        );
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const payload = {
        roomId: room.id,
        room_id: room.id,
        roomNumber: room.room_number,
        roomType: room.room_type,
        additionalRooms: additionalRoomsList.map((r) => r.id),
        additional_room_ids: additionalRoomsList.map((r) => r.id),
        guestName: draft.guestName,
        guest_name: draft.guestName,
        fatherName: draft.fatherName,
        father_name: draft.fatherName,
        mobile: draft.mobile,
        altMobile: draft.altMobile,
        alt_mobile: draft.altMobile,
        email: draft.email,
        dob: draft.dob,
        expiryDate: draft.expiryDate,
        expiry_date: draft.expiryDate,
        address: draft.address,
        docType: draft.docType,
        doc_type: draft.docType,
        docFront: draft.docFront,
        doc_front: draft.docFront,
        docBack: draft.docBack,
        doc_back: draft.docBack,
        guestPhoto: draft.guestPhoto,
        guest_photo: draft.guestPhoto,
        adultsMale: draft.adultsMale,
        adults_male: draft.adultsMale,
        adultsFemale: draft.adultsFemale,
        adults_female: draft.adultsFemale,
        children: draft.children,
        extraBeds: extraBeds,
        extra_beds: isOta ? ((Number(draft.otaBookedExtraBeds) || 0) + (Number(draft.extraAdults) || 0)) : extraBeds,
        roomExtraBeds: draft.roomExtraBeds || {},
        room_extra_beds: draft.roomExtraBeds || {},
        roomExtraBedRates: draft.roomExtraBedRates || {},
        room_extra_bed_rates: draft.roomExtraBedRates || {},
        extraBedRate: draft.extraBedRate,
        extra_bed_rate: draft.extraBedRate,
        extraBedCharge: extraBedCharge,
        extra_bed_charge: extraBedCharge,
        checkinTime: draft.checkinTime,
        checkin_time: draft.checkinTime,
        approxCheckout: draft.approxCheckout,
        approx_checkout_time: draft.approxCheckout,
        baseRate: basePrice,
        room_rate: basePrice,
        discountPct: effectiveDiscountPct,
        discount_pct: effectiveDiscountPct,
        netCharge: (isOta && isOtaPrepaid) ? allowedTotalCharge : totalDue,
        total_room_charge: (isOta && isOtaPrepaid) ? allowedTotalCharge : totalDue,
        extensionCharge: extensionCharge,
        extension_charge: extensionCharge,
        mealPlan: draft.mealPlan,
        meal_plan: draft.mealPlan,
        mealCharge: mealTotalCharge,
        meal_charge: mealTotalCharge,
        extraMealPlan: isOta ? (draft.extraMealPlan || 'without_breakfast') : null,
        extra_meal_plan: isOta ? (draft.extraMealPlan || 'without_breakfast') : null,
        extraBreakfastCharge: isOta ? extraBreakfastCharge : 0,
        extra_breakfast_charge: isOta ? extraBreakfastCharge : 0,
        bookingSource: draft.bookingSource,
        booking_source: draft.bookingSource,
        otaPlatform: isOta ? draft.otaPlatform : null,
        ota_platform: isOta ? draft.otaPlatform : null,
        otaVoucherNo: isOta ? draft.otaVoucherNo : null,
        ota_booking_id: isOta ? draft.otaVoucherNo : null,
        otaBillAmount: isOta ? draft.otaManualAmount : null,
        ota_bill_amount: isOta ? draft.otaManualAmount : null,
        otaIsPrepaid: isOtaPrepaid,
        is_prepaid: isOtaPrepaid ? 1 : 0,
        isPrepaid: isOtaPrepaid,
        rateType: isOta ? (isOtaPrepaid ? 'prepaid' : 'pay_at_hotel') : 'standard',
        rate_type: isOta ? (isOtaPrepaid ? 'prepaid' : 'pay_at_hotel') : 'standard',
        otaBookedAdults: isOta ? draft.otaBookedAdults : null,
        ota_booked_adults: isOta ? draft.otaBookedAdults : null,
        otaBookedChildren: isOta ? draft.otaBookedChildren : null,
        ota_booked_children: isOta ? draft.otaBookedChildren : null,
        otaBookedExtraBeds: isOta ? (Number(draft.otaBookedExtraBeds) || 0) : 0,
        ota_booked_extra_beds: isOta ? (Number(draft.otaBookedExtraBeds) || 0) : 0,
        extraAdults: Number(draft.extraAdults) || 0,
        extra_adults: Number(draft.extraAdults) || 0,
        extraChildren: Number(draft.extraChildren) || 0,
        extra_children: Number(draft.extraChildren) || 0,
        hasExtraPersons: Boolean(draft.hasExtraPersons),
        additionalRooms: (additionalRoomsList || []).map(r => r.id),
        additional_rooms: (additionalRoomsList || []).map(r => r.id),
        isEarlyCheckin: isOta ? Boolean(draft.isEarlyCheckin) : false,
        is_early_checkin: isOta ? (draft.isEarlyCheckin ? 1 : 0) : 0,
        originalCheckinTime: isOta ? draft.originalCheckinTime : null,
        original_checkin_time: isOta ? draft.originalCheckinTime : null,
        earlyCheckinTime: isOta ? draft.earlyCheckinTime : null,
        early_checkin_time: isOta ? draft.earlyCheckinTime : null,
        btcCompanyId: draft.bookingSource === 'BTC' ? draft.btcCompanyId : null,
        btc_company_id: draft.bookingSource === 'BTC' ? draft.btcCompanyId : null,
        btcCompanyName: draft.bookingSource === 'BTC' ? draft.btcCompanyName : null,
        btc_company_name: draft.bookingSource === 'BTC' ? draft.btcCompanyName : null,
        btcVoucherNo: draft.bookingSource === 'BTC' ? draft.btcVoucherNo : null,
        companyName: (draft.companyName || draft.company_name || '').trim(),
        company_name: (draft.companyName || draft.company_name || '').trim(),
        gstNumber: (draft.gstNumber || draft.gst_number || '').trim(),
        gst_number: (draft.gstNumber || draft.gst_number || '').trim(),
        splitCash: draft.splitCash,
        split_cash: draft.splitCash,
        splitOnline: draft.splitOnline,
        split_online: draft.splitOnline,
        onlineUtr: (draft.onlineUtr || draft.utrNumber || '').trim(),
        online_utr: (draft.onlineUtr || draft.utrNumber || '').trim(),
        utrNumber: (draft.onlineUtr || draft.utrNumber || '').trim(),
        utr_number: (draft.onlineUtr || draft.utrNumber || '').trim(),
        advance_utr_number: (draft.onlineUtr || draft.utrNumber || '').trim(),
        splitCard: draft.splitCard,
        split_card: draft.splitCard,
        card_surcharge: (Number(draft.splitCard) > 0 && cardPct > 0) ? Math.round((Number(draft.splitCard) * cardPct) / 100) : 0,
        advance_card_surcharge: (Number(draft.splitCard) > 0 && cardPct > 0) ? Math.round((Number(draft.splitCard) * cardPct) / 100) : 0,
        upi_tax: ((Number(draft.splitOnline) || 0) > upiThresh && upiPct > 0) ? Math.round(((Number(draft.splitOnline) || 0) * upiPct) / 100) : 0,
        advance_upi_tax: ((Number(draft.splitOnline) || 0) > upiThresh && upiPct > 0) ? Math.round(((Number(draft.splitOnline) || 0) * upiPct) / 100) : 0,
        splitCheque: draft.splitCheque,
        split_cheque: draft.splitCheque,
        chequeNo: draft.chequeNo,
        advance_cheque_no: draft.chequeNo,
        chequeBank: draft.chequeBank,
        advance_cheque_bank: draft.chequeBank,
        chequeDate: draft.chequeDate,
        advance_cheque_date: draft.chequeDate,
        chequeScan: draft.chequeScan,
        advance_cheque_photo: draft.chequeScan,
        cheque_photo: draft.chequeScan,
        memberDocuments: draft.memberDocuments || [],
        member_documents: draft.memberDocuments || [],
        aadharNumber: (draft.aadharNumber || draft.idNumber || '').trim(),
        aadhar_number: (draft.aadharNumber || draft.idNumber || '').trim(),
        checkedInBy: currentUser ? (currentUser.full_name || currentUser.username) : 'Front Desk',
        checked_in_by: currentUser ? (currentUser.full_name || currentUser.username) : 'Front Desk'
      };

      const onlineAmt = Number(draft.splitOnline) || 0;
      const utrVal = (draft.onlineUtr || draft.utrNumber || '').trim();
      if (onlineAmt > 0 && !utrVal) {
        showToast('Please enter the UTR / Transaction Reference ID for Online payment.', 'red');
        setCurrentStep(7);
        setIsSubmitting(false);
        return;
      }

      const res = await api.checkin(payload);
      if (res && res.success) {
        showToast(`Guest ${draft.guestName} checked into Room #${room.room_number}!`, 'green', 4000);
        const splitCash = Number(draft.splitCash) || 0;
        const splitOnline = Number(draft.splitOnline) || 0;
        const splitCard = Number(draft.splitCard) || 0;
        const splitCheque = Number(draft.splitCheque) || 0;
        const totalPaid = splitCash + splitOnline + splitCard + splitCheque;
        const standardVoucher = cleanVoucherNumber(res.data?.voucherNumber || res.voucherNumber || res.data?.voucher_number || '260916-001');
        const advReceiptNo = res.data?.advanceReceiptNo || res.advanceReceiptNo || null;

        const regData = {
          voucher_number: standardVoucher,
          voucherNumber: standardVoucher,
          receipt_no: advReceiptNo,
          guestName: draft.guestName,
          fatherName: draft.fatherName,
          mobile: draft.mobile,
          altMobile: draft.altMobile,
          email: draft.email,
          address: draft.address,
          dob: draft.dob,
          aadharNumber: draft.aadharNumber || draft.idNumber || '',
          docType: draft.docType || 'Aadhar Card',
          docFront: draft.docFront,
          docBack: draft.docBack,
          guestPhoto: draft.guestPhoto,
          room: room,
          additionalRooms: additionalRoomsList,
          all_group_rooms: [room, ...(additionalRoomsList || [])],
          roomNumber: room.room_number,
          roomType: room.room_type,
          checkinTime: res.data?.checkinTime || draft.checkinTime,
          approxCheckout: draft.approxCheckout,
          stayNights: draft.stayNights || nights || 1,
          adultsMale: draft.adultsMale,
          adultsFemale: draft.adultsFemale,
          children: draft.children,
          extraBeds: isOta ? ((Number(draft.otaBookedExtraBeds) || 0) + (Number(draft.extraAdults) || 0)) : extraBeds,
          roomExtraBeds: draft.roomExtraBeds || {},
          mealPlan: draft.mealPlan,
          baseRate: basePrice,
          roomTariffNet: totalDue - gstAmount,
          discountPct: effectiveDiscountPct,
          discountAmount: discountAmount,
          taxAmount: gstAmount,
          netCharge: totalDue,
          totalDue: totalDue,
          totalPaid: totalPaid,
          balanceDue: Math.max(0, totalDue - totalPaid),
          splitCash: splitCash,
          splitOnline: splitOnline,
          splitCard: splitCard,
          card_surcharge: (splitCard > 0 && cardPct > 0) ? Math.round((splitCard * cardPct) / 100) : 0,
          cardSurcharge: (splitCard > 0 && cardPct > 0) ? Math.round((splitCard * cardPct) / 100) : 0,
          upi_tax: (splitOnline > upiThresh && upiPct > 0) ? Math.round((splitOnline * upiPct) / 100) : 0,
          upiTax: (splitOnline > upiThresh && upiPct > 0) ? Math.round((splitOnline * upiPct) / 100) : 0,
          splitCheque: splitCheque,
          onlineUtr: (draft.onlineUtr || draft.utrNumber || '').trim(),
          chequeNo: draft.chequeNo || '',
          chequeBank: draft.chequeBank || '',
          bookingSource: draft.bookingSource || 'Walk-in',
          otaPlatform: isOta ? draft.otaPlatform : null,
          ota_platform: isOta ? draft.otaPlatform : null,
          otaBookingId: isOta ? (draft.otaVoucherNo || draft.otaBookingId || '').trim() : '',
          ota_booking_id: isOta ? (draft.otaVoucherNo || draft.otaBookingId || '').trim() : '',
          otaVoucherNo: isOta ? (draft.otaVoucherNo || draft.otaBookingId || '').trim() : '',
          rateType: isOta ? (isOtaPrepaid ? 'prepaid' : 'pay_at_hotel') : 'standard',
          rate_type: isOta ? (isOtaPrepaid ? 'prepaid' : 'pay_at_hotel') : 'standard',
          isPrepaid: isOtaPrepaid,
          is_prepaid: isOtaPrepaid,
          isEarlyCheckin: isOta ? Boolean(draft.isEarlyCheckin) : false,
          is_early_checkin: isOta ? (draft.isEarlyCheckin ? 1 : 0) : 0,
          originalCheckinTime: isOta ? draft.originalCheckinTime : null,
          original_checkin_time: isOta ? draft.originalCheckinTime : null,
          earlyCheckinTime: isOta ? draft.earlyCheckinTime : null,
          early_checkin_time: isOta ? draft.earlyCheckinTime : null,
          btcCompanyId: draft.btcCompanyId || null,
          btcCompanyName: draft.btcCompanyName || '',
          btcCompanyAddress: draft.btcCompanyAddress || draft.address || '',
          btcCompanyGst: draft.btcCompanyGst || draft.gstNumber || '',
          btcCompanyPan: draft.btcCompanyPan || '',
          btcCompanyContactPerson: draft.btcCompanyContactPerson || '',
          btcCompanyPhone: draft.btcCompanyPhone || '',
          btcCompanyEmail: draft.btcCompanyEmail || '',
          btcApprovalRef: draft.btcVoucherNo || draft.btcApprovalRef || '',
          companyName: (draft.btcCompanyName || draft.companyName || draft.company_name || '').trim(),
          company_name: (draft.btcCompanyName || draft.companyName || draft.company_name || '').trim(),
          gstNumber: (draft.btcCompanyGst || draft.gstNumber || draft.gst_number || '').trim(),
          gst_number: (draft.btcCompanyGst || draft.gstNumber || draft.gst_number || '').trim(),
          otaBookedAdults: isOta ? (draft.otaBookedAdults !== undefined ? Number(draft.otaBookedAdults) : 1) : null,
          ota_booked_adults: isOta ? (draft.otaBookedAdults !== undefined ? Number(draft.otaBookedAdults) : 1) : null,
          otaBookedChildren: isOta ? (draft.otaBookedChildren !== undefined ? Number(draft.otaBookedChildren) : 0) : null,
          ota_booked_children: isOta ? (draft.otaBookedChildren !== undefined ? Number(draft.otaBookedChildren) : 0) : null,
          otaBookedExtraBeds: isOta ? (Number(draft.otaBookedExtraBeds) || 0) : 0,
          ota_booked_extra_beds: isOta ? (Number(draft.otaBookedExtraBeds) || 0) : 0,
          extraAdults: Number(draft.extraAdults) || 0,
          extra_adults: Number(draft.extraAdults) || 0,
          extraChildren: Number(draft.extraChildren) || 0,
          extra_children: Number(draft.extraChildren) || 0,
          hasExtraPersons: Boolean(draft.hasExtraPersons || Number(draft.extraAdults) > 0 || Number(draft.extraChildren) > 0 || extraBedCharge > 0),
          extraBedCharge: extraBedCharge,
          extra_bed_charge: extraBedCharge,
          hotelChargedBeds: isOta ? (Number(draft.extraAdults) || (extraBedCharge > 0 ? Math.round(extraBedCharge / 500) : 0)) : (extraBedCharge > 0 ? Math.round(extraBedCharge / 500) : 0),
          voucherIncludedBeds: isOta ? (Number(draft.otaBookedExtraBeds) || 0) : 0,
          extraRoomsCharge: extraRoomsCharge,
          extra_rooms_charge: extraRoomsCharge,
          extraBreakfastCharge: extraBreakfastCharge,
          extra_breakfast_charge: extraBreakfastCharge,
          otaBillAmount: isOta ? (Number(draft.otaManualAmount) || (basePrice * nights)) : null,
          ota_bill_amount: isOta ? (Number(draft.otaManualAmount) || (basePrice * nights)) : null,
          memberDocuments: draft.memberDocuments || [],
          checkedInBy: currentUser ? (currentUser.full_name || currentUser.username) : 'Front Desk'
        };

        // 1. Print paper registration card for signing IMMEDIATELY (Zero delay preview)
        printGuestRegistrationA4(regData, { includePhotos: false });

        // 2. Defer heavy PDF digital archive export so it doesn't freeze the main thread or print preview
        setTimeout(() => {
          downloadGuestRegistrationPDF(regData).catch(err => {
            console.warn('Auto PDF download notice:', err);
          });
        }, 2000);

        onClose();
        if (onCheckinSuccess) onCheckinSuccess(res.booking || res);
      } else {
        showToast('Check-in error: ' + (res?.message || 'Server error'), 'red');
      }
    } catch (err) {
      showToast('Check-in failed: ' + err.message, 'red');
    } finally {
      setIsSubmitting(false);
    }
  };

  const stepsList = [
    { num: 1, label: 'Document' },
    { num: 2, label: 'Front Scan' },
    { num: 3, label: 'Back Scan' },
    { num: 4, label: 'Verify Details' },
    { num: 5, label: 'Guest Photo' },
    { num: 6, label: 'Stay' },
    { num: 7, label: 'Payment' }
  ];

  return (
    <>
      <div className="modal-overlay active" id="checkin-modal-overlay">
        <div className="modal-container checkin-fullscreen-modal">
          {/* Modal Header with Universal Top-Left Back & Top-Right Close Buttons */}
          <div className="modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 24px', minHeight: '40px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button
                type="button"
                className="universal-back-btn"
                id="btn-checkin-top-back"
                onClick={() => {
                  if (currentStep > 1) {
                    handlePrev();
                  } else {
                    onClose();
                  }
                }}
                title={currentStep > 1 ? 'Go to previous step' : 'Cancel Check-in & Close'}
                style={{ height: '30px', padding: '2px 10px', fontSize: '0.80rem' }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ width: '14px', height: '14px' }}>
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
                <span>Back</span>
              </button>
              <div>
                <h3 id="checkin-modal-title" style={{ margin: 0, fontSize: '1.05rem', fontWeight: 850, color: 'var(--text-primary)' }}>
                  Guest Check-In: Room {room.room_number} {additionalRoomsList.length > 0 ? `(+ #${additionalRoomsList.map((r) => r.room_number).join(', #')})` : ''}
                </h3>
              </div>
            </div>
            <button
              type="button"
              className="universal-close-btn modal-close-btn"
              onClick={onClose}
              title="Close Check-In Wizard"
              style={{ width: '30px', height: '30px', minWidth: '30px', minHeight: '30px', fontSize: '1.25rem' }}
            >
              &times;
            </button>
          </div>

          {/* Step Indicators: Compact bar to maximize vertical space and eliminate scrolling */}
          <div
            className="checkin-step-nav-bar"
            style={{ padding: '3px 24px 2px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-light)' }}
          >
            <div className="step-indicators" style={{ position: 'relative', marginBottom: '2px' }}>
              {/* Main Connecting Progress Track */}
              <div
                style={{
                  position: 'absolute',
                  top: '11px',
                  left: 'calc(100% / 14)',
                  right: 'calc(100% / 14)',
                  height: '3px',
                  background: '#e2e8f0',
                  zIndex: 1,
                  borderRadius: '2px',
                  overflow: 'hidden'
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${((Math.max(1, Math.min(7, Math.floor(currentStep))) - 1) / 6) * 100}%`,
                    background: 'linear-gradient(90deg, #16a34a 0%, #22c55e 100%)',
                    transition: 'width 0.3s ease'
                  }}
                />
              </div>

              {stepsList.map((s) => {
                const isCompleted = s.num < Math.floor(currentStep);
                const isActive = s.num === Math.floor(currentStep);
                const isReachable = s.num <= maxReachedStep && !isActive;
                const isRemaining = s.num > maxReachedStep;
                return (
                  <div
                    key={s.num}
                    className={`step-item ${isActive ? 'active' : ''} ${isCompleted ? 'completed step-clickable' : isReachable ? 'step-clickable' : 'step-locked'}`}
                    onClick={() => {
                      if (isCompleted || isReachable) {
                        setCurrentStep(s.num);
                      }
                    }}
                    style={{
                      position: 'relative',
                      zIndex: 2,
                      cursor: isCompleted || isReachable ? 'pointer' : isActive ? 'default' : 'not-allowed',
                      opacity: isRemaining ? 0.38 : 1,
                      transition: 'all 0.2s ease'
                    }}
                    title={
                      isCompleted
                        ? `Step ${s.num}: ${s.label} (Completed - Click to return)`
                        : isActive
                        ? `Step ${s.num}: ${s.label} (Current Step)`
                        : isReachable
                        ? `Step ${s.num}: ${s.label} (Previously Reached - Click to navigate)`
                        : `Step ${s.num}: ${s.label} (Locked - Complete current step first)`
                    }
                  >
                    <div
                      className="step-bubble"
                      style={
                        isCompleted
                          ? {
                              background: '#16a34a',
                              borderColor: '#15803d',
                              color: '#ffffff',
                              boxShadow: '0 1px 4px rgba(22, 163, 74, 0.3)',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 900,
                              width: '22px',
                              height: '22px',
                              fontSize: '0.72rem',
                              margin: '0 auto 1px'
                            }
                          : isActive
                          ? {
                              background: 'var(--apple-blue)',
                              borderColor: 'var(--apple-blue)',
                              color: '#ffffff',
                              boxShadow: '0 0 8px rgba(0, 113, 227, 0.4)',
                              transform: 'scale(1.08)',
                              fontWeight: 900,
                              width: '22px',
                              height: '22px',
                              fontSize: '0.72rem',
                              margin: '0 auto 1px'
                            }
                          : isReachable
                          ? {
                              background: '#dcfce7',
                              borderColor: '#86efac',
                              color: '#15803d',
                              cursor: 'pointer',
                              boxShadow: '0 1px 3px rgba(22, 163, 74, 0.15)',
                              fontWeight: 850,
                              width: '22px',
                              height: '22px',
                              fontSize: '0.72rem',
                              margin: '0 auto 1px'
                            }
                          : {
                              background: '#f8fafc',
                              borderColor: '#cbd5e1',
                              color: '#94a3b8',
                              cursor: 'not-allowed',
                              width: '22px',
                              height: '22px',
                              fontSize: '0.72rem',
                              margin: '0 auto 1px'
                            }
                      }
                    >
                      {s.num}
                    </div>
                    <span
                      className="step-label"
                      style={
                        isCompleted
                          ? { color: '#15803d', fontWeight: 800, fontSize: '0.70rem', lineHeight: 1 }
                          : isActive
                          ? { color: 'var(--apple-blue)', fontWeight: 850, fontSize: '0.70rem', lineHeight: 1 }
                          : isReachable
                          ? { color: '#166534', fontWeight: 750, fontSize: '0.70rem', lineHeight: 1 }
                          : { color: '#94a3b8', fontWeight: 650, fontSize: '0.70rem', lineHeight: 1 }
                      }
                    >
                      {s.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Prominent Middle-Vertical Side Navigation Custom Arrows */}
          {currentStep > 1 && currentStep !== 3.5 && (
            <button
              type="button"
              className="wizard-side-custom-arrow nav-prev"
              id="btn-side-checkin-prev"
              title="Previous Step"
              onClick={handlePrev}
            >
              <svg viewBox="0 0 156 134" className="custom-arrow-icon" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M 156,67 L 153,64 L 150,61 L 147,58 L 144,55 L 141,52 L 138,49 L 135,46 L 132,43 L 129,40 L 126,37 L 123,34 L 120,31 L 117,28 L 114,25 L 111,22 L 108,19 L 105,16 L 103,13 L 100,10 L 97,7 L 94,4 L 91,1 L 83,0 L 75,3 L 71,6 L 67,9 L 64,12 L 61,15 L 59,18 L 57,21 L 55,24 L 53,27 L 50,30 L 48,33 L 46,36 L 44,39 L 41,42 L 38,45 L 35,48 L 32,51 L 28,54 L 24,57 L 19,60 L 12,63 L 2,66 L 0,67 L 4,68 L 13,71 L 20,74 L 25,77 L 29,80 L 33,83 L 36,86 L 39,89 L 42,92 L 44,95 L 46,98 L 49,101 L 51,104 L 53,107 L 55,110 L 57,113 L 59,116 L 62,119 L 65,122 L 68,125 L 71,128 L 77,131 L 86,134 L 89,134 L 92,131 L 95,128 L 98,125 L 101,122 L 104,119 L 107,116 L 110,113 L 113,110 L 116,107 L 119,104 L 122,101 L 125,98 L 128,95 L 131,92 L 134,89 L 137,86 L 140,83 L 143,80 L 146,77 L 149,74 L 152,71 L 155,68 Z"
                  fill="currentColor"
                />
              </svg>
            </button>
          )}

          {currentStep !== 3.5 && (
            <button
              type="button"
              className="wizard-side-custom-arrow nav-next"
              id="btn-side-checkin-next"
              title={currentStep === 7 ? 'Complete Check-In' : 'Proceed to Next Step'}
              onClick={handleNext}
              disabled={isSubmitting}
            >
              <svg viewBox="0 0 156 134" className="custom-arrow-icon" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M 0,67 L 3,64 L 6,61 L 9,58 L 12,55 L 15,52 L 18,49 L 21,46 L 24,43 L 27,40 L 30,37 L 33,34 L 36,31 L 39,28 L 42,25 L 45,22 L 48,19 L 51,16 L 53,13 L 56,10 L 59,7 L 62,4 L 65,1 L 73,0 L 81,3 L 85,6 L 89,9 L 92,12 L 95,15 L 97,18 L 99,21 L 101,24 L 103,27 L 106,30 L 108,33 L 110,36 L 112,39 L 115,42 L 118,45 L 121,48 L 124,51 L 128,54 L 132,57 L 137,60 L 144,63 L 154,66 L 156,67 L 152,68 L 143,71 L 136,74 L 131,77 L 127,80 L 123,83 L 120,86 L 117,89 L 114,92 L 112,95 L 110,98 L 107,101 L 105,104 L 103,107 L 101,110 L 99,113 L 97,116 L 94,119 L 91,122 L 88,125 L 85,128 L 79,131 L 70,134 L 67,134 L 64,131 L 61,128 L 58,125 L 55,122 L 52,119 L 49,116 L 46,113 L 43,110 L 40,107 L 37,104 L 34,101 L 31,98 L 28,95 L 25,92 L 22,89 L 19,86 L 16,83 L 13,80 L 10,77 L 7,74 L 4,71 L 1,68 Z"
                  fill="currentColor"
                />
              </svg>
            </button>
          )}

          {currentStep === 3 && (
            <button
              type="button"
              className="wizard-side-nav-btn nav-skip-back"
              id="btn-side-skip-back"
              title="Skip Back Scan (Single-Sided ID)"
              onClick={handleSkipBack}
            >
              <svg
                className="skip-btn-svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="5 4 15 12 5 20 5 4" fill="currentColor" />
                <line x1="19" y1="5" x2="19" y2="19" />
              </svg>
              <span className="skip-btn-title">Skip Back Scan</span>
              <span className="skip-btn-pill">Single-Sided</span>
            </button>
          )}



          {/* Modal Body */}
          <div className="modal-body" ref={modalBodyRef}>
            <ErrorBoundary>
              {currentStep === 1 && (
                <Step1Source
                  room={room}
                  additionalRooms={additionalRoomsList}
                  setAdditionalRooms={setAdditionalRoomsList}
                  availableRooms={readyRooms}
                  draft={draft}
                  updateDraft={updateDraft}
                  onManualEntry={handleManualEntry}
                  onProceedToScan={(docType) => {
                    updateDraft({ docType });
                    setCurrentStep(2);
                  }}
                />
              )}

              {currentStep === 2 && (
                <Step2FrontScan
                  draft={draft}
                  updateDraft={updateDraft}
                  onManualEntry={handleManualEntry}
                  onPreviewDoc={openLightbox}
                />
              )}

              {currentStep === 3 && (
                <Step3BackScan
                  draft={draft}
                  updateDraft={updateDraft}
                  onSkipBack={handleSkipBack}
                  onPreviewDoc={openLightbox}
                />
              )}

              {currentStep === 3.5 && (
                <StepParsingAI draft={draft} updateDraft={updateDraft} onComplete={() => setCurrentStep(4)} />
              )}

              {currentStep === 4 && (
                <Step4Details
                  draft={draft}
                  updateDraft={updateDraft}
                  onReanalyzeAI={() => setCurrentStep(3.5)}
                  onPreviewDoc={openLightbox}
                />
              )}

              {currentStep === 5 && (
                <Step5Photo
                  draft={draft}
                  updateDraft={updateDraft}
                  onPreviewDoc={openLightbox}
                />
              )}

              {currentStep === 6 && (
                <Step6Stay
                  room={room}
                  additionalRooms={additionalRoomsList}
                  setAdditionalRooms={setAdditionalRoomsList}
                  availableRooms={readyRooms}
                  draft={draft}
                  updateDraft={updateDraft}
                  roomGstPct={roomGstPct}
                />
              )}

              {currentStep === 7 && (
                <Step7Payment
                  draft={draft}
                  updateDraft={updateDraft}
                  totalDue={totalDue}
                  onPreviewDoc={openLightbox}
                  onSubmitCheckin={handleSubmitCheckin}
                  onPrev={handlePrev}
                  isSubmitting={isSubmitting}
                />
              )}
            </ErrorBoundary>
          </div>
        </div>
      </div>

      <ImageLightbox
        isOpen={Boolean(lightboxImage)}
        title={lightboxTitle}
        imageUrl={lightboxImage}
        onClose={() => setLightboxImage(null)}
      />
    </>
  );
}
