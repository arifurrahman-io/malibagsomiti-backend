const PDFDocument = require("pdfkit");

exports.generateMemberStatement = (res, member, transactions) => {
  const doc = new PDFDocument({ margin: 50 });

  // Stream the PDF directly to the response for "fast load"
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=statement-${member.name}.pdf`,
  );
  doc.pipe(res);

  // Header - Society Branding
  doc.fontSize(20).text("Malibagh Somiti", { align: "center" });
  doc.fontSize(10).text("Monthly Transaction Statement", { align: "center" });
  doc.moveDown();

  // Member Info
  doc.fontSize(12).text(`Member Name: ${member.name}`);
  doc.text(`Branch: ${member.branch}`);
  doc.text(`Total Shares: ${member.shares}`);
  doc.moveDown();

  // Table-like Header
  doc
    .fontSize(12)
    .text("Date           Type           Amount (BDT)", { underline: true });

  // Dynamic Transaction Rows
  transactions.forEach((t) => {
    doc
      .fontSize(10)
      .text(
        `${new Date(t.date).toLocaleDateString()}      ${t.type}      ${
          t.amount
        }`,
      );
  });

  doc.end();
};
