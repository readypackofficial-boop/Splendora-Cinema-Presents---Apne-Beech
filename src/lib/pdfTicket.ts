import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import type { TicketRecord } from '../types/cinema';
import { formatShowDate } from './defaults';

export async function downloadTicketPDF(ticket: TicketRecord): Promise<void> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a5',
  });

  const W = 148;
  const H = 210;

  // Ivory parchment canvas
  doc.setFillColor(250, 245, 235);
  doc.rect(0, 0, W, H, 'F');

  // Deep burgundy royal header
  doc.setFillColor(91, 14, 29);
  doc.rect(0, 0, W, 38, 'F');

  // Antique gold outer frame
  doc.setDrawColor(198, 161, 91);
  doc.setLineWidth(0.8);
  doc.rect(6, 6, W - 12, H - 12);
  doc.setLineWidth(0.3);
  doc.rect(8, 8, W - 16, H - 16);

  // Header Typography
  doc.setTextColor(218, 185, 118);
  doc.setFont('times', 'bold');
  doc.setFontSize(18);
  doc.text('SPLENDORA CINEMA', W / 2, 19, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(243, 234, 218);
  doc.text('OFFICIAL DIGITAL ADMIT PASS  ·  VERIFIED ENTRY', W / 2, 26, { align: 'center' });

  // Movie Title
  doc.setTextColor(91, 14, 29);
  doc.setFont('times', 'bold');
  doc.setFontSize(22);
  doc.text(ticket.movieTitle || 'APNE BEECH', W / 2, 52, { align: 'center' });

  doc.setDrawColor(198, 161, 91);
  doc.line(20, 57, W - 20, 57);

  // Ticket Info Grid
  const leftX = 16;
  const rightX = 80;
  let y = 66;

  const drawField = (label: string, value: string, x: number, yPos: number, maxWidth = 56) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(122, 92, 68);
    doc.text(label.toUpperCase(), x, yPos);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(42, 24, 18);
    const lines = doc.splitTextToSize(value, maxWidth);
    doc.text(lines, x, yPos + 4.5);
  };

  drawField('Booking ID', ticket.bookingId, leftX, y);
  drawField('Show ID', ticket.screeningId, rightX, y);
  y += 14;

  drawField('Screening Date', formatShowDate(ticket.date), leftX, y);
  drawField('Show Time', ticket.startTime || 'To Be Announced', rightX, y);
  y += 14;

  drawField('Guest Name', ticket.customerName, leftX, y);
  drawField('Number of Tickets', `${ticket.seatNumbers.length} Seat(s)`, rightX, y);
  y += 14;

  drawField('Assigned Seats', ticket.seatNumbers.join(', '), leftX, y, 116);
  y += 14;

  drawField('In-Seat Mocktail Order', ticket.mocktailSummary || 'None', leftX, y, 116);
  y += 14;

  const discountLabel =
    ticket.discountAmount && ticket.discountAmount > 0
      ? `INR ${Number(ticket.grandTotal).toLocaleString('en-IN')} (-INR ${Number(ticket.discountAmount).toLocaleString('en-IN')} disc.)`
      : `INR ${Number(ticket.grandTotal).toLocaleString('en-IN')}`;
  drawField('Total Paid', discountLabel, leftX, y);
  drawField(
    'Payment & Ticket Status',
    `${ticket.complimentaryDrinks ? 'COMP DRINKS · ' : ''}VERIFIED · ${ticket.ticketStatus}`,
    rightX,
    y
  );

  // Dashed tear line
  y += 14;
  doc.setDrawColor(198, 161, 91);
  doc.setLineDashPattern([2, 2], 0);
  doc.line(12, y, W - 12, y);
  doc.setLineDashPattern([], 0);

  // Generate QR code image
  const qrDataUrl = await QRCode.toDataURL(ticket.qrPayload, {
    width: 320,
    margin: 1,
    color: {
      dark: '#2A1812',
      light: '#FFFDF9',
    },
  });

  doc.addImage(qrDataUrl, 'PNG', W / 2 - 22, y + 5, 44, 44);

  doc.setFont('courier', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(91, 14, 29);
  doc.text(`TICKET ID: ${ticket.ticketId}`, W / 2, y + 54, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(110, 88, 72);
  doc.text(
    'Present this QR code at the Splendora Cinema entrance. Valid for single atomic check-in.',
    W / 2,
    y + 60,
    { align: 'center' }
  );

  doc.save(`SPLENDORA_${ticket.bookingId}_${ticket.ticketId}.pdf`);
}
