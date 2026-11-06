// Ready-made practical-test tasks for every sample database.
//
// Each sample has a profile: the new table students add, a validation rule,
// fields to filter on, joins, totals, a calculated field, an update query, a
// form and a report. From the profile the library makes tasks whose values are
// picked from the real data when the test is created (so two tests made from
// the same sample are not identical). Every task carries:
//   * the wording students see,
//   * a check (the marking key),
//   * solve(): a model answer, used by the unit tests and by "Build a model
//     answer" in the test builder so a teacher can try the key.
import { WowProject, uid } from '@/engine/project';
import { autoForm, autoReport } from '@/engine/objects';
import { buildSample, SAMPLE_LIST, type SampleId } from '@/engine/samples';
import type { DataType } from '@/engine/types';
import type { Check, ExamTask } from './checks';

export interface LibTask extends ExamTask { key: string; group: string; solve: (p: WowProject) => void; }

type Row = Record<string, unknown>;
interface NewTable { name: string; parent: string; parentKey: string; fk: string; pk: string; fields: [string, DataType][]; typeField: string; cascade?: boolean; about: string; record: (fk: unknown, i: number) => Row; }
interface Filter { table: string; field: string; show: string[]; sort?: string; }
interface Fixed { text: string; sql: string; }
interface Profile {
  newTable: NewTable;
  validation: { table: string; field: string; rule: string; rejects: string; text: string };
  text: Filter; number: Filter; like: Filter; date: Filter;
  joins: [Fixed, Fixed]; totals: [Fixed, Fixed]; calc: Fixed;
  update: { table: string; field: string; pk: string; whereField: string; pct: number; add?: number };
  form: { source: string; fields: string[] };
  report: { source: string; group: string; total: string; show: string[] };
}

const day = (i: number) => `2026-0${1 + (i % 9)}-1${i % 9}`;

const PROFILES: Record<SampleId, Profile> = {
  school: {
    newTable: { name: 'Clubs', parent: 'Teachers', parentKey: 'TeacherID', fk: 'TeacherID', pk: 'ClubID', fields: [['ClubID', 'AutoNumber'], ['ClubName', 'Short Text'], ['TeacherID', 'Number'], ['MeetingDay', 'Short Text'], ['Fee', 'Currency']], typeField: 'Fee', about: 'after-school clubs, each run by one teacher', record: (fk, i) => ({ ClubName: ['Chess', 'Drama', 'Coding'][i], TeacherID: fk, MeetingDay: ['Monday', 'Wednesday', 'Friday'][i], Fee: 20 + i * 5 }) },
    validation: { table: 'Teachers', field: 'HireDate', rule: '<=Date()', rejects: '2099-01-01', text: 'a teacher\'s HireDate cannot be in the future' },
    text: { table: 'Students', field: 'Town', show: ['FirstName', 'LastName', 'Town'], sort: 'LastName' },
    number: { table: 'Students', field: 'FeePaid', show: ['FirstName', 'LastName', 'FeePaid'] },
    like: { table: 'Students', field: 'LastName', show: ['FirstName', 'LastName'] },
    date: { table: 'Students', field: 'DateOfBirth', show: ['FirstName', 'LastName', 'DateOfBirth'] },
    joins: [
      { text: 'shows each student\'s FirstName and LastName with the ClassName of their class, sorted by ClassName', sql: 'SELECT s.FirstName, s.LastName, c.ClassName FROM Students s JOIN Classes c ON s.ClassID = c.ClassID ORDER BY c.ClassName' },
      { text: 'shows each subject\'s SubjectName with the LastName of the teacher who teaches it', sql: 'SELECT sb.SubjectName, t.LastName FROM Subjects sb JOIN Teachers t ON sb.TeacherID = t.TeacherID' },
    ],
    totals: [
      { text: 'counts the students in each class, showing the ClassName and the number of students', sql: 'SELECT c.ClassName, count(s.StudentID) FROM Classes c JOIN Students s ON s.ClassID = c.ClassID GROUP BY c.ClassName' },
      { text: 'shows each Town with the total FeePaid by students from that town', sql: 'SELECT Town, sum(FeePaid) FROM Students GROUP BY Town' },
    ],
    calc: { text: 'shows FirstName, LastName, FeePaid and a calculated field Balance that is 2000 minus FeePaid', sql: 'SELECT FirstName, LastName, FeePaid, 2000 - FeePaid FROM Students' },
    update: { table: 'Students', field: 'FeePaid', pk: 'StudentID', whereField: 'Town', pct: 10 },
    form: { source: 'Students', fields: ['FirstName', 'LastName', 'ClassID', 'Town'] },
    report: { source: 'Students', group: 'Town', total: 'FeePaid', show: ['FirstName', 'LastName', 'FeePaid'] },
  },
  library: {
    newTable: { name: 'Reviews', parent: 'Books', parentKey: 'BookID', fk: 'BookID', pk: 'ReviewID', fields: [['ReviewID', 'AutoNumber'], ['BookID', 'Number'], ['ReviewerName', 'Short Text'], ['Rating', 'Number'], ['ReviewDate', 'Date/Time']], typeField: 'ReviewDate', cascade: true, about: 'readers\' reviews of books (deleting a book should delete its reviews)', record: (fk, i) => ({ BookID: fk, ReviewerName: ['Ama', 'Kojo', 'Esi'][i], Rating: 3 + (i % 3), ReviewDate: day(i) }) },
    validation: { table: 'Books', field: 'Copies', rule: '>=0', rejects: '-1', text: 'the number of Copies cannot be negative' },
    text: { table: 'Members', field: 'Town', show: ['FirstName', 'LastName', 'Town'], sort: 'LastName' },
    number: { table: 'Books', field: 'Price', show: ['Title', 'Price'] },
    like: { table: 'Books', field: 'Title', show: ['Title', 'YearPublished'] },
    date: { table: 'Loans', field: 'LoanDate', show: ['LoanID', 'BookID', 'LoanDate'] },
    joins: [
      { text: 'shows the Title of each book with its AuthorName, sorted by AuthorName', sql: 'SELECT b.Title, a.AuthorName FROM Books b JOIN Authors a ON b.AuthorID = a.AuthorID ORDER BY a.AuthorName' },
      { text: 'shows the member\'s LastName, the book Title and the DueDate of every loan that has not been returned', sql: 'SELECT m.LastName, b.Title, l.DueDate FROM Loans l JOIN Members m ON l.MemberID = m.MemberID JOIN Books b ON l.BookID = b.BookID WHERE l.Returned = 0' },
    ],
    totals: [
      { text: 'counts the books in each category, showing the CategoryName and the number of books', sql: 'SELECT c.CategoryName, count(b.BookID) FROM Categories c JOIN Books b ON b.CategoryID = c.CategoryID GROUP BY c.CategoryName' },
      { text: 'counts the loans made by each member, showing the member\'s MemberID and the number of loans', sql: 'SELECT MemberID, count(LoanID) FROM Loans GROUP BY MemberID' },
    ],
    calc: { text: 'shows Title, Copies, Price and a calculated field StockValue that is Copies multiplied by Price', sql: 'SELECT Title, Copies, Price, Copies * Price FROM Books' },
    update: { table: 'Books', field: 'Price', pk: 'BookID', whereField: 'CategoryID', pct: 20 },
    form: { source: 'Books', fields: ['Title', 'AuthorID', 'CategoryID', 'Price'] },
    report: { source: 'Books', group: 'CategoryID', total: 'Copies', show: ['Title', 'Copies'] },
  },
  hospital: {
    newTable: { name: 'Wards', parent: 'Departments', parentKey: 'DepartmentID', fk: 'DepartmentID', pk: 'WardID', fields: [['WardID', 'AutoNumber'], ['WardName', 'Short Text'], ['DepartmentID', 'Number'], ['Beds', 'Number'], ['OpenedDate', 'Date/Time']], typeField: 'Beds', about: 'hospital wards, each belonging to one department', record: (fk, i) => ({ WardName: ['Ward A', 'Ward B', 'Ward C'][i], DepartmentID: fk, Beds: 10 + i * 4, OpenedDate: day(i) }) },
    validation: { table: 'Prescriptions', field: 'Days', rule: 'Between 1 And 90', rejects: '0', text: 'a prescription must last between 1 and 90 Days' },
    text: { table: 'Patients', field: 'Town', show: ['FirstName', 'LastName', 'Town'], sort: 'LastName' },
    number: { table: 'Appointments', field: 'Fee', show: ['AppointmentID', 'AppointmentDate', 'Fee'] },
    like: { table: 'Patients', field: 'LastName', show: ['FirstName', 'LastName'] },
    date: { table: 'Appointments', field: 'AppointmentDate', show: ['AppointmentID', 'PatientID', 'AppointmentDate'] },
    joins: [
      { text: 'shows each doctor\'s LastName and Specialty with the DepartmentName, sorted by DepartmentName', sql: 'SELECT d.LastName, d.Specialty, dp.DepartmentName FROM Doctors d JOIN Departments dp ON d.DepartmentID = dp.DepartmentID ORDER BY dp.DepartmentName' },
      { text: 'shows each appointment\'s AppointmentDate with the patient\'s LastName and the doctor\'s LastName, sorted by AppointmentDate', sql: 'SELECT a.AppointmentDate, p.LastName, d.LastName FROM Appointments a JOIN Patients p ON a.PatientID = p.PatientID JOIN Doctors d ON a.DoctorID = d.DoctorID ORDER BY a.AppointmentDate' },
    ],
    totals: [
      { text: 'shows each Specialty with the total Fee of the appointments with doctors of that specialty', sql: 'SELECT d.Specialty, sum(a.Fee) FROM Doctors d JOIN Appointments a ON a.DoctorID = d.DoctorID GROUP BY d.Specialty' },
      { text: 'counts the appointments for each Reason', sql: 'SELECT Reason, count(AppointmentID) FROM Appointments GROUP BY Reason' },
    ],
    calc: { text: 'shows AppointmentID, Fee and a calculated field FeeWithTax that is Fee multiplied by 1.15', sql: 'SELECT AppointmentID, Fee, Fee * 1.15 FROM Appointments' },
    update: { table: 'Appointments', field: 'Fee', pk: 'AppointmentID', whereField: 'Reason', pct: 10 },
    form: { source: 'Patients', fields: ['FirstName', 'LastName', 'DateOfBirth', 'Town'] },
    report: { source: 'Appointments', group: 'DoctorID', total: 'Fee', show: ['AppointmentDate', 'Reason', 'Fee'] },
  },
  shop: {
    newTable: { name: 'Deliveries', parent: 'Orders', parentKey: 'OrderID', fk: 'OrderID', pk: 'DeliveryID', fields: [['DeliveryID', 'AutoNumber'], ['OrderID', 'Number'], ['DeliveryDate', 'Date/Time'], ['Courier', 'Short Text'], ['Cost', 'Currency']], typeField: 'Cost', cascade: true, about: 'deliveries of orders (deleting an order should delete its deliveries)', record: (fk, i) => ({ OrderID: fk, DeliveryDate: day(i), Courier: ['FastBike', 'CityVan', 'PostGH'][i], Cost: 15 + i * 5 }) },
    validation: { table: 'Products', field: 'ReorderLevel', rule: '>=0', rejects: '-5', text: 'the ReorderLevel cannot be negative' },
    text: { table: 'Customers', field: 'Town', show: ['CustomerName', 'Town'], sort: 'CustomerName' },
    number: { table: 'Products', field: 'UnitPrice', show: ['ProductName', 'UnitPrice'] },
    like: { table: 'Products', field: 'ProductName', show: ['ProductName', 'UnitPrice'] },
    date: { table: 'Orders', field: 'OrderDate', show: ['OrderID', 'CustomerID', 'OrderDate'] },
    joins: [
      { text: 'shows each ProductName with the CompanyName of its supplier, sorted by CompanyName', sql: 'SELECT p.ProductName, s.CompanyName FROM Products p JOIN Suppliers s ON p.SupplierID = s.SupplierID ORDER BY s.CompanyName' },
      { text: 'shows each OrderID and OrderDate with the CustomerName, sorted by OrderDate', sql: 'SELECT o.OrderID, o.OrderDate, c.CustomerName FROM Orders o JOIN Customers c ON o.CustomerID = c.CustomerID ORDER BY o.OrderDate' },
    ],
    totals: [
      { text: 'counts the products in each Category', sql: 'SELECT Category, count(ProductID) FROM Products GROUP BY Category' },
      { text: 'shows each ProductName with the total Quantity ordered', sql: 'SELECT p.ProductName, sum(od.Quantity) FROM Products p JOIN OrderDetails od ON od.ProductID = p.ProductID GROUP BY p.ProductName' },
    ],
    calc: { text: 'shows ProductName, UnitPrice, UnitsInStock and a calculated field StockValue that is UnitPrice multiplied by UnitsInStock', sql: 'SELECT ProductName, UnitPrice, UnitsInStock, UnitPrice * UnitsInStock FROM Products' },
    update: { table: 'Products', field: 'UnitPrice', pk: 'ProductID', whereField: 'Category', pct: 10 },
    form: { source: 'Products', fields: ['ProductName', 'SupplierID', 'Category', 'UnitPrice'] },
    report: { source: 'Products', group: 'Category', total: 'UnitsInStock', show: ['ProductName', 'UnitsInStock'] },
  },
  employee: {
    newTable: { name: 'Training', parent: 'Employees', parentKey: 'EmployeeID', fk: 'EmployeeID', pk: 'TrainingID', fields: [['TrainingID', 'AutoNumber'], ['EmployeeID', 'Number'], ['CourseName', 'Short Text'], ['StartDate', 'Date/Time'], ['Cost', 'Currency']], typeField: 'StartDate', cascade: true, about: 'training courses taken by employees (deleting an employee should delete their training)', record: (fk, i) => ({ EmployeeID: fk, CourseName: ['First Aid', 'Excel', 'Leadership'][i], StartDate: day(i), Cost: 300 + i * 100 }) },
    validation: { table: 'Employees', field: 'HireDate', rule: '<=Date()', rejects: '2099-01-01', text: 'an employee\'s HireDate cannot be in the future' },
    text: { table: 'Employees', field: 'DepartmentID', show: ['FirstName', 'LastName', 'DepartmentID'], sort: 'LastName' },
    number: { table: 'Salaries', field: 'Amount', show: ['EmployeeID', 'EffectiveDate', 'Amount'] },
    like: { table: 'Employees', field: 'LastName', show: ['FirstName', 'LastName'] },
    date: { table: 'Employees', field: 'HireDate', show: ['FirstName', 'LastName', 'HireDate'] },
    joins: [
      { text: 'shows each employee\'s FirstName and LastName with their DepartmentName, sorted by DepartmentName', sql: 'SELECT e.FirstName, e.LastName, d.DepartmentName FROM Employees e JOIN Departments d ON e.DepartmentID = d.DepartmentID ORDER BY d.DepartmentName' },
      { text: 'shows each employee\'s LastName with the LastName of their manager (add the Employees table twice and join ManagerID to EmployeeID)', sql: 'SELECT e.LastName, m.LastName FROM Employees e JOIN Employees m ON e.ManagerID = m.EmployeeID' },
    ],
    totals: [
      { text: 'counts the employees in each department, showing the DepartmentName and the number of employees', sql: 'SELECT d.DepartmentName, count(e.EmployeeID) FROM Departments d JOIN Employees e ON e.DepartmentID = d.DepartmentID GROUP BY d.DepartmentName' },
      { text: 'shows each EmployeeID with their highest salary Amount', sql: 'SELECT EmployeeID, max(Amount) FROM Salaries GROUP BY EmployeeID' },
    ],
    calc: { text: 'shows Title, MinSalary, MaxSalary and a calculated field SalaryRange that is MaxSalary minus MinSalary', sql: 'SELECT Title, MinSalary, MaxSalary, MaxSalary - MinSalary FROM Positions' },
    update: { table: 'Salaries', field: 'Amount', pk: 'SalaryID', whereField: 'EmployeeID', pct: 5 },
    form: { source: 'Employees', fields: ['FirstName', 'LastName', 'DepartmentID', 'HireDate'] },
    report: { source: 'Salaries', group: 'EmployeeID', total: 'Amount', show: ['EffectiveDate', 'Amount'] },
  },
  sports: {
    newTable: { name: 'Sponsors', parent: 'Teams', parentKey: 'TeamID', fk: 'TeamID', pk: 'SponsorID', fields: [['SponsorID', 'AutoNumber'], ['TeamID', 'Number'], ['SponsorName', 'Short Text'], ['AmountPerYear', 'Currency'], ['StartDate', 'Date/Time']], typeField: 'AmountPerYear', about: 'sponsors of teams (a team can have many sponsors)', record: (fk, i) => ({ TeamID: fk, SponsorName: ['Sunrise Bank', 'Volta Water', 'Kente Mobile'][i], AmountPerYear: 5000 + i * 2500, StartDate: day(i) }) },
    validation: { table: 'Players', field: 'ShirtNumber', rule: 'Between 1 And 99', rejects: '0', text: 'a ShirtNumber must be between 1 and 99' },
    text: { table: 'Players', field: 'Position', show: ['FirstName', 'LastName', 'Position'], sort: 'LastName' },
    number: { table: 'Matches', field: 'Attendance', show: ['MatchID', 'MatchDate', 'Attendance'] },
    like: { table: 'Players', field: 'LastName', show: ['FirstName', 'LastName', 'TeamID'] },
    date: { table: 'Players', field: 'DateOfBirth', show: ['FirstName', 'LastName', 'DateOfBirth'] },
    joins: [
      { text: 'shows each player\'s FirstName, LastName and Position with their TeamName, sorted by TeamName', sql: 'SELECT p.FirstName, p.LastName, p.Position, t.TeamName FROM Players p JOIN Teams t ON p.TeamID = t.TeamID ORDER BY t.TeamName' },
      { text: 'shows the LastName of the scorer and the Minute of every goal, sorted by Minute', sql: 'SELECT p.LastName, g.Minute FROM Goals g JOIN Players p ON g.PlayerID = p.PlayerID ORDER BY g.Minute' },
    ],
    totals: [
      { text: 'counts the players in each team, showing the TeamName and the number of players', sql: 'SELECT t.TeamName, count(p.PlayerID) FROM Teams t JOIN Players p ON p.TeamID = t.TeamID GROUP BY t.TeamName' },
      { text: 'shows each TeamName with the total Attendance at its home matches (join TeamID to HomeTeamID)', sql: 'SELECT t.TeamName, sum(m.Attendance) FROM Teams t JOIN Matches m ON m.HomeTeamID = t.TeamID GROUP BY t.TeamName' },
    ],
    calc: { text: 'shows MatchID, HomeGoals, AwayGoals and a calculated field TotalGoals that is HomeGoals plus AwayGoals', sql: 'SELECT MatchID, HomeGoals, AwayGoals, HomeGoals + AwayGoals FROM Matches' },
    update: { table: 'Matches', field: 'Attendance', pk: 'MatchID', whereField: 'HomeTeamID', pct: 0, add: 500 },
    form: { source: 'Players', fields: ['FirstName', 'LastName', 'TeamID', 'Position'] },
    report: { source: 'Matches', group: 'HomeTeamID', total: 'Attendance', show: ['MatchDate', 'Attendance'] },
  },
  hotel: {
    newTable: { name: 'Payments', parent: 'Bookings', parentKey: 'BookingID', fk: 'BookingID', pk: 'PaymentID', fields: [['PaymentID', 'AutoNumber'], ['BookingID', 'Number'], ['PaymentDate', 'Date/Time'], ['Amount', 'Currency'], ['Method', 'Short Text']], typeField: 'Amount', cascade: true, about: 'payments for bookings (deleting a booking should delete its payments)', record: (fk, i) => ({ BookingID: fk, PaymentDate: day(i), Amount: 400 + i * 150, Method: ['Cash', 'Card', 'Mobile Money'][i] }) },
    validation: { table: 'Rooms', field: 'Floor', rule: 'Between 1 And 10', rejects: '0', text: 'the Floor must be between 1 and 10' },
    text: { table: 'Guests', field: 'Country', show: ['FirstName', 'LastName', 'Country'], sort: 'LastName' },
    number: { table: 'Bookings', field: 'Nights', show: ['BookingID', 'CheckIn', 'Nights'] },
    like: { table: 'Guests', field: 'LastName', show: ['FirstName', 'LastName'] },
    date: { table: 'Bookings', field: 'CheckIn', show: ['BookingID', 'RoomNumber', 'CheckIn'] },
    joins: [
      { text: 'shows each booking\'s CheckIn date, RoomNumber and Nights with the guest\'s LastName, sorted by CheckIn', sql: 'SELECT b.CheckIn, b.RoomNumber, b.Nights, g.LastName FROM Bookings b JOIN Guests g ON b.GuestID = g.GuestID ORDER BY b.CheckIn' },
      { text: 'shows each RoomNumber with its TypeName and Rate, sorted by RoomNumber', sql: 'SELECT r.RoomNumber, t.TypeName, t.Rate FROM Rooms r JOIN RoomTypes t ON r.RoomTypeID = t.RoomTypeID ORDER BY r.RoomNumber' },
    ],
    totals: [
      { text: 'counts the bookings from each Source', sql: 'SELECT Source, count(BookingID) FROM Bookings GROUP BY Source' },
      { text: 'shows each TypeName with the total Nights booked in rooms of that type', sql: 'SELECT t.TypeName, sum(b.Nights) FROM RoomTypes t JOIN Rooms r ON r.RoomTypeID = t.RoomTypeID JOIN Bookings b ON b.RoomNumber = r.RoomNumber GROUP BY t.TypeName' },
    ],
    calc: { text: 'shows TypeName, Rate and a calculated field WeeklyRate that is Rate multiplied by 7', sql: 'SELECT TypeName, Rate, Rate * 7 FROM RoomTypes' },
    update: { table: 'RoomTypes', field: 'Rate', pk: 'RoomTypeID', whereField: 'TypeName', pct: 15 },
    form: { source: 'Bookings', fields: ['GuestID', 'RoomNumber', 'CheckIn', 'Nights'] },
    report: { source: 'Bookings', group: 'Source', total: 'Nights', show: ['CheckIn', 'RoomNumber', 'Nights'] },
  },
  transport: {
    newTable: { name: 'Maintenance', parent: 'Buses', parentKey: 'BusID', fk: 'BusID', pk: 'MaintenanceID', fields: [['MaintenanceID', 'AutoNumber'], ['BusID', 'Number'], ['ServiceDate', 'Date/Time'], ['Description', 'Short Text'], ['Cost', 'Currency']], typeField: 'ServiceDate', cascade: true, about: 'services and repairs of buses (deleting a bus should delete its maintenance records)', record: (fk, i) => ({ BusID: fk, ServiceDate: day(i), Description: ['Oil change', 'New tyres', 'Brake check'][i], Cost: 250 + i * 300 }) },
    validation: { table: 'Buses', field: 'Seats', rule: 'Between 10 And 80', rejects: '5', text: 'a bus must have between 10 and 80 Seats' },
    text: { table: 'Buses', field: 'Make', show: ['RegNumber', 'Make', 'Seats'], sort: 'RegNumber' },
    number: { table: 'Trips', field: 'Passengers', show: ['TripID', 'TripDate', 'Passengers'] },
    like: { table: 'Drivers', field: 'LastName', show: ['FirstName', 'LastName'] },
    date: { table: 'Trips', field: 'TripDate', show: ['TripID', 'RouteID', 'TripDate'] },
    joins: [
      { text: 'shows each trip\'s TripDate and Passengers with the Origin and Destination of its route, sorted by TripDate', sql: 'SELECT t.TripDate, t.Passengers, r.Origin, r.Destination FROM Trips t JOIN Routes r ON t.RouteID = r.RouteID ORDER BY t.TripDate' },
      { text: 'shows the TripDate, the driver\'s LastName and the bus RegNumber of every trip that was Delayed', sql: 'SELECT t.TripDate, d.LastName, b.RegNumber FROM Trips t JOIN Drivers d ON t.DriverID = d.DriverID JOIN Buses b ON t.BusID = b.BusID WHERE t.Delayed <> 0' },
    ],
    totals: [
      { text: 'shows each RegNumber with the total Passengers carried by that bus', sql: 'SELECT b.RegNumber, sum(t.Passengers) FROM Buses b JOIN Trips t ON t.BusID = b.BusID GROUP BY b.RegNumber' },
      { text: 'counts the trips made on each route, showing the RouteID and the number of trips', sql: 'SELECT RouteID, count(TripID) FROM Trips GROUP BY RouteID' },
    ],
    calc: { text: 'shows Origin, Destination, Fare and a calculated field ReturnFare that is Fare multiplied by 2', sql: 'SELECT Origin, Destination, Fare, Fare * 2 FROM Routes' },
    update: { table: 'Routes', field: 'Fare', pk: 'RouteID', whereField: 'Origin', pct: 10 },
    form: { source: 'Drivers', fields: ['FirstName', 'LastName', 'LicenceClass', 'Phone'] },
    report: { source: 'Trips', group: 'RouteID', total: 'Passengers', show: ['TripDate', 'Passengers'] },
  },
  cinema: {
    newTable: { name: 'Promotions', parent: 'Films', parentKey: 'FilmID', fk: 'FilmID', pk: 'PromoID', fields: [['PromoID', 'AutoNumber'], ['FilmID', 'Number'], ['PromoName', 'Short Text'], ['Discount', 'Number'], ['EndDate', 'Date/Time']], typeField: 'EndDate', about: 'promotions for films (a film can have many promotions)', record: (fk, i) => ({ FilmID: fk, PromoName: ['Student Tuesday', 'Family Pack', 'Early Bird'][i], Discount: 10 + i * 5, EndDate: day(i) }) },
    validation: { table: 'Films', field: 'DurationMins', rule: 'Between 60 And 240', rejects: '30', text: 'a film must last between 60 and 240 minutes (DurationMins)' },
    text: { table: 'Films', field: 'Genre', show: ['Title', 'Genre', 'AgeRating'], sort: 'Title' },
    number: { table: 'Films', field: 'DurationMins', show: ['Title', 'DurationMins'] },
    like: { table: 'Films', field: 'Title', show: ['Title', 'Genre'] },
    date: { table: 'Showings', field: 'ShowDate', show: ['ShowingID', 'FilmID', 'ShowDate'] },
    joins: [
      { text: 'shows each showing\'s ShowDate and StartTime with the film Title and the ScreenName, sorted by ShowDate', sql: 'SELECT s.ShowDate, s.StartTime, f.Title, sc.ScreenName FROM Showings s JOIN Films f ON s.FilmID = f.FilmID JOIN Screens sc ON s.ScreenID = sc.ScreenID ORDER BY s.ShowDate' },
      { text: 'shows the customer\'s LastName, the film Title and the SeatNo of every ticket', sql: 'SELECT c.LastName, f.Title, t.SeatNo FROM Tickets t JOIN Customers c ON t.CustomerID = c.CustomerID JOIN Showings s ON t.ShowingID = s.ShowingID JOIN Films f ON s.FilmID = f.FilmID' },
    ],
    totals: [
      { text: 'counts the tickets sold for each film, showing the Title and the number of tickets', sql: 'SELECT f.Title, count(t.TicketID) FROM Films f JOIN Showings s ON s.FilmID = f.FilmID JOIN Tickets t ON t.ShowingID = s.ShowingID GROUP BY f.Title' },
      { text: 'counts the films in each Genre', sql: 'SELECT Genre, count(FilmID) FROM Films GROUP BY Genre' },
    ],
    calc: { text: 'shows Title, DurationMins and a calculated field WithAdverts that is DurationMins plus 20', sql: 'SELECT Title, DurationMins, DurationMins + 20 FROM Films' },
    update: { table: 'Showings', field: 'TicketPrice', pk: 'ShowingID', whereField: 'StartTime', pct: 20 },
    form: { source: 'Films', fields: ['Title', 'Genre', 'AgeRating', 'DurationMins'] },
    report: { source: 'Tickets', group: 'CustomerID', total: 'PricePaid', show: ['ShowingID', 'SeatNo', 'PricePaid'] },
  },
  restaurant: {
    newTable: { name: 'Reservations', parent: 'DiningTables', parentKey: 'TableNo', fk: 'TableNo', pk: 'ReservationID', fields: [['ReservationID', 'AutoNumber'], ['TableNo', 'Number'], ['GuestName', 'Short Text'], ['ReservationDate', 'Date/Time'], ['Deposit', 'Currency']], typeField: 'Deposit', about: 'table reservations (a table can be reserved many times)', record: (fk, i) => ({ TableNo: fk, GuestName: ['Mr Owusu', 'Ms Darko', 'Dr Addo'][i], ReservationDate: day(i), Deposit: 50 + i * 25 }) },
    validation: { table: 'DiningTables', field: 'Seats', rule: 'Between 1 And 12', rejects: '0', text: 'a table must have between 1 and 12 Seats' },
    text: { table: 'MenuItems', field: 'Category', show: ['ItemName', 'Category', 'Price'], sort: 'ItemName' },
    number: { table: 'MenuItems', field: 'Price', show: ['ItemName', 'Price'] },
    like: { table: 'MenuItems', field: 'ItemName', show: ['ItemName', 'Price'] },
    date: { table: 'Orders', field: 'OrderDate', show: ['OrderID', 'TableNo', 'OrderDate'] },
    joins: [
      { text: 'shows each OrderID, OrderDate and TableNo with the waiter\'s LastName, sorted by OrderDate', sql: 'SELECT o.OrderID, o.OrderDate, o.TableNo, w.LastName FROM Orders o JOIN Waiters w ON o.WaiterID = w.WaiterID ORDER BY o.OrderDate' },
      { text: 'shows the OrderID, ItemName and Quantity of every vegetarian item ordered', sql: 'SELECT oi.OrderID, m.ItemName, oi.Quantity FROM OrderItems oi JOIN MenuItems m ON oi.ItemID = m.ItemID WHERE m.Vegetarian <> 0' },
    ],
    totals: [
      { text: 'shows each ItemName with the total Quantity sold', sql: 'SELECT m.ItemName, sum(oi.Quantity) FROM MenuItems m JOIN OrderItems oi ON oi.ItemID = m.ItemID GROUP BY m.ItemName' },
      { text: 'counts the menu items in each Category', sql: 'SELECT Category, count(ItemID) FROM MenuItems GROUP BY Category' },
    ],
    calc: { text: 'shows OrderID, ItemName, Quantity, Price and a calculated field LineTotal that is Quantity multiplied by Price', sql: 'SELECT oi.OrderID, m.ItemName, oi.Quantity, m.Price, oi.Quantity * m.Price FROM OrderItems oi JOIN MenuItems m ON oi.ItemID = m.ItemID' },
    update: { table: 'MenuItems', field: 'Price', pk: 'ItemID', whereField: 'Category', pct: 10 },
    form: { source: 'MenuItems', fields: ['ItemName', 'Category', 'Price', 'Vegetarian'] },
    report: { source: 'MenuItems', group: 'Category', total: 'Price', show: ['ItemName', 'Price'] },
  },
  farm: {
    newTable: { name: 'Inspections', parent: 'Plots', parentKey: 'PlotID', fk: 'PlotID', pk: 'InspectionID', fields: [['InspectionID', 'AutoNumber'], ['PlotID', 'Number'], ['InspectionDate', 'Date/Time'], ['Inspector', 'Short Text'], ['Passed', 'Yes/No']], typeField: 'Passed', cascade: true, about: 'inspections of plots (deleting a plot should delete its inspections)', record: (fk, i) => ({ PlotID: fk, InspectionDate: day(i), Inspector: ['K. Mensah', 'A. Boateng', 'E. Osei'][i], Passed: i === 1 ? 0 : 1 }) },
    validation: { table: 'Plots', field: 'Hectares', rule: '>0', rejects: '0', text: 'a plot\'s Hectares must be more than 0' },
    text: { table: 'Farmers', field: 'Region', show: ['FirstName', 'LastName', 'Village', 'Region'], sort: 'LastName' },
    number: { table: 'Harvests', field: 'KgHarvested', show: ['HarvestID', 'HarvestDate', 'KgHarvested'] },
    like: { table: 'Farmers', field: 'LastName', show: ['FirstName', 'LastName', 'Village'] },
    date: { table: 'Harvests', field: 'HarvestDate', show: ['HarvestID', 'PlotID', 'HarvestDate'] },
    joins: [
      { text: 'shows each farmer\'s LastName and Village with the Hectares and SoilType of their plots, sorted by LastName', sql: 'SELECT f.LastName, f.Village, p.Hectares, p.SoilType FROM Farmers f JOIN Plots p ON p.FarmerID = f.FarmerID ORDER BY f.LastName' },
      { text: 'shows the HarvestDate, CropName and KgHarvested of every organic harvest', sql: 'SELECT h.HarvestDate, c.CropName, h.KgHarvested FROM Harvests h JOIN Crops c ON h.CropID = c.CropID WHERE h.Organic <> 0' },
    ],
    totals: [
      { text: 'shows each CropName with the total KgHarvested', sql: 'SELECT c.CropName, sum(h.KgHarvested) FROM Crops c JOIN Harvests h ON h.CropID = c.CropID GROUP BY c.CropName' },
      { text: 'shows each Village with the total Hectares of its farmers\' plots', sql: 'SELECT f.Village, sum(p.Hectares) FROM Farmers f JOIN Plots p ON p.FarmerID = f.FarmerID GROUP BY f.Village' },
    ],
    calc: { text: 'shows HarvestID, CropName, KgHarvested, PricePerKg and a calculated field HarvestValue that is KgHarvested multiplied by PricePerKg', sql: 'SELECT h.HarvestID, c.CropName, h.KgHarvested, c.PricePerKg, h.KgHarvested * c.PricePerKg FROM Harvests h JOIN Crops c ON h.CropID = c.CropID' },
    update: { table: 'Crops', field: 'PricePerKg', pk: 'CropID', whereField: 'Season', pct: 10 },
    form: { source: 'Farmers', fields: ['FirstName', 'LastName', 'Village', 'Region'] },
    report: { source: 'Plots', group: 'SoilType', total: 'Hectares', show: ['FarmerID', 'Hectares'] },
  },
};

// ---------------------------------------------------------------- helpers
const qi = (s: string) => `"${s.replace(/"/g, '""')}"`;
const lit = (v: unknown) => (typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const cols = (f: string[]) => f.map(qi).join(', ');
function rngFrom(seed: number) { let s = (seed >>> 0) || 1; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
function values(p: WowProject, sql: string): unknown[] { return p.db.query(sql).rows.map((r) => r[0]).filter((v) => v !== null && v !== ''); }
function choose<T>(r: () => number, a: T[]): T { return a[Math.floor(r() * a.length)]; }
function save(p: WowProject, name: string, sql: string) { p.saveQuery({ name, kind: 'select', sql }); }

/** The tasks for one sample, with values drawn from `p` (the starting database). */
export function taskLibrary(sample: SampleId, p: WowProject, seed = 1): LibTask[] {
  const P = PROFILES[sample]; const r = rngFrom(seed);
  const out: LibTask[] = [];
  const add = (key: string, group: string, marks: number, text: string, check: Check, solve: (x: WowProject) => void) => out.push({ id: uid('task'), key, group, marks, text, check, solve });

  // ---- tables and relationships
  const N = P.newTable;
  const parentKeys = values(p, `SELECT ${qi(N.parentKey)} FROM ${qi(N.parent)} ORDER BY 1 LIMIT 3`);
  const fieldList = N.fields.map(([n, t]) => `${n} (${t === 'AutoNumber' ? 'AutoNumber' : t})`).join(', ');
  const makeTable = (x: WowProject) => {
    if (x.getTable(N.name)) return;
    x.saveTableDesign({ name: N.name, description: '', fields: N.fields.map(([n, t]) => ({ id: uid('f'), name: n, type: t, primaryKey: n === N.pk || undefined, fieldSize: t === 'Short Text' ? 50 : undefined })) });
  };
  const makeRel = (x: WowProject) => { makeTable(x); if (!x.relationships().some((y) => y.primaryTable === N.parent && y.relatedTable === N.name)) x.saveRelationship({ primaryTable: N.parent, relatedTable: N.name, fields: [{ primary: N.parentKey, related: N.fk }], enforce: true, cascadeUpdate: false, cascadeDelete: !!N.cascade, joinType: 'inner' }); };
  add('table.pk', 'Tables and relationships', 2, `Create a table called ${N.name} to store ${N.about}. It needs these fields: ${fieldList}. Make ${N.pk} the primary key.`, { kind: 'primaryKey', table: N.name, fields: [N.pk] }, makeTable);
  const tf = N.fields.find(([n]) => n === N.typeField)!;
  add('table.type', 'Tables and relationships', 1, `In ${N.name}, ${tf[0]} must have the ${tf[1]} data type.`, { kind: 'field', table: N.name, field: tf[0], type: tf[1] }, makeTable);
  add('table.rel', 'Tables and relationships', 2, `Create a one-to-many relationship from ${N.parent} (${N.parentKey}) to ${N.name} (${N.fk}) and enforce referential integrity${N.cascade ? ', with Cascade Delete Related Records' : ''}.`, { kind: 'relationship', primary: N.parent, related: N.name, enforce: true, ...(N.cascade ? { cascadeDelete: true } : {}) }, makeRel);
  add('table.records', 'Tables and relationships', 1, `Enter at least 3 records in ${N.name}. Each ${N.fk} must match an existing ${N.parent} record.`, { kind: 'sql', sql: `SELECT count(*) >= 3 AND sum(${qi(N.fk)} NOT IN (SELECT ${qi(N.parentKey)} FROM ${qi(N.parent)})) = 0 FROM ${qi(N.name)}`, label: `${N.name} has at least 3 records, all linked to a ${N.parent} record` },
    (x) => { makeRel(x); parentKeys.slice(0, 3).forEach((k, i) => x.insertRecord(N.name, N.record(k, i))); });

  // ---- validation
  const V = P.validation;
  add('validation', 'Validation', 2, `Add a validation rule and validation text to ${V.table}.${V.field} so that ${V.text}.`, { kind: 'validation', table: V.table, field: V.field, rejects: V.rejects },
    (x) => { const t = x.getTable(V.table)!; x.saveTableDesign({ ...t, fields: t.fields.map((f) => (f.name === V.field ? { ...f, validationRule: V.rule, validationText: `Check ${V.field}.` } : f)) }, t.name); });

  // ---- single-table queries with picked values
  const T = P.text; const tv = choose(r, values(p, `SELECT DISTINCT ${qi(T.field)} FROM ${qi(T.table)} ORDER BY 1`));
  const tSql = `SELECT ${cols(T.show)} FROM ${qi(T.table)} WHERE ${qi(T.field)} = ${lit(tv)}${T.sort ? ` ORDER BY ${qi(T.sort)}` : ''}`;
  add('query.text', 'Queries', 2, `Create a query called qryByValue that shows ${T.show.join(', ')} from ${T.table} where ${T.field} is ${tv}${T.sort ? `, sorted by ${T.sort} (A to Z)` : ''}.`, { kind: 'queryResult', sql: tSql }, (x) => save(x, 'qryByValue', tSql));

  const Nm = P.number; const nums = values(p, `SELECT ${qi(Nm.field)} FROM ${qi(Nm.table)} ORDER BY 1`).map(Number);
  const nv = nums[Math.floor(nums.length * (0.35 + r() * 0.3))];
  const nSql = `SELECT ${cols(Nm.show)} FROM ${qi(Nm.table)} WHERE ${qi(Nm.field)} > ${nv} ORDER BY ${qi(Nm.field)} DESC`;
  add('query.number', 'Queries', 2, `Create a query called qryAbove that shows ${Nm.show.join(', ')} from ${Nm.table} where ${Nm.field} is more than ${nv}, sorted by ${Nm.field} from highest to lowest.`, { kind: 'queryResult', sql: nSql }, (x) => save(x, 'qryAbove', nSql));

  const L = P.like; const letter = String(choose(r, values(p, `SELECT DISTINCT upper(substr(${qi(L.field)}, 1, 1)) FROM ${qi(L.table)}`)));
  const lSql = `SELECT ${cols(L.show)} FROM ${qi(L.table)} WHERE ${qi(L.field)} LIKE '${letter}%'`;
  add('query.like', 'Queries', 2, `Create a query called qryStartsWith that shows ${L.show.join(', ')} from ${L.table} where ${L.field} starts with the letter ${letter} (use a wildcard).`, { kind: 'queryResult', sql: lSql }, (x) => save(x, 'qryStartsWith', lSql));

  const D = P.date; const dates = values(p, `SELECT ${qi(D.field)} FROM ${qi(D.table)}`).map(String);
  const d0 = choose(r, dates); const years = new Set(dates.map((d) => d.slice(0, 4)));
  const byYear = years.size > 1; const y = d0.slice(0, 4), m = d0.slice(5, 7);
  const from = byYear ? `${y}-01-01` : `${y}-${m}-01`, to = byYear ? `${y}-12-31` : `${y}-${m}-31`;
  const monthName = new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
  const dSql = `SELECT ${cols(D.show)} FROM ${qi(D.table)} WHERE ${qi(D.field)} BETWEEN '${from}' AND '${to}' ORDER BY ${qi(D.field)}`;
  add('query.date', 'Queries', 2, `Create a query called qryDates that shows ${D.show.join(', ')} from ${D.table} where ${D.field} is in ${byYear ? y : `${monthName} ${y}`}, sorted by ${D.field} (oldest first). Use Between … And.`, { kind: 'queryResult', sql: dSql }, (x) => save(x, 'qryDates', dSql));

  const pv = String(choose(r, values(p, `SELECT DISTINCT ${qi(T.field)} FROM ${qi(T.table)} ORDER BY 1`)));
  const pSql = `SELECT ${cols(T.show)} FROM ${qi(T.table)} WHERE ${qi(T.field)} = ${lit(typeof tv === 'number' ? Number(pv) : pv)}`;
  add('query.parameter', 'Queries', 2, `Create a parameter query called qryAsk that asks "Enter the ${T.field}" when it runs and shows ${T.show.join(', ')} from ${T.table} for the value entered. (It will be tried with ${pv}.)`, { kind: 'parameter', sql: pSql, value: pv, query: 'qryAsk' },
    (x) => save(x, 'qryAsk', `SELECT ${cols(T.show)} FROM ${qi(T.table)} WHERE ${qi(T.field)} = [Enter the ${T.field}]`));

  // ---- multi-table, totals, calculated
  P.joins.forEach((j, i) => add(`query.join${i + 1}`, 'Queries', 3, `Create a query called qryJoin${i + 1} that ${j.text}.`, { kind: 'queryResult', sql: j.sql }, (x) => save(x, `qryJoin${i + 1}`, j.sql)));
  P.totals.forEach((j, i) => add(`query.totals${i + 1}`, 'Totals and calculations', 3, `Create a totals query called qryTotals${i + 1} that ${j.text}.`, { kind: 'queryResult', sql: j.sql }, (x) => save(x, `qryTotals${i + 1}`, j.sql)));
  add('query.calc', 'Totals and calculations', 2, `Create a query called qryCalc that ${P.calc.text}.`, { kind: 'queryResult', sql: P.calc.sql }, (x) => save(x, 'qryCalc', P.calc.sql));

  // ---- update query (expected values worked out now, from the starting data)
  const U = P.update; const uv = choose(r, values(p, `SELECT DISTINCT ${qi(U.whereField)} FROM ${qi(U.table)} ORDER BY 1`));
  const ids = values(p, `SELECT ${qi(U.pk)} FROM ${qi(U.table)} WHERE ${qi(U.whereField)} = ${lit(uv)}`);
  const inIds = `${qi(U.pk)} IN (${ids.map(lit).join(', ')})`;
  const before = Number(p.db.scalar(`SELECT sum(${qi(U.field)}) FROM ${qi(U.table)} WHERE ${inIds}`));
  const others = Number(p.db.scalar(`SELECT coalesce(sum(${qi(U.field)}), 0) FROM ${qi(U.table)} WHERE NOT (${inIds})`));
  const want = U.add ? before + U.add * ids.length : Math.round(before * (1 + U.pct / 100) * 100) / 100;
  const tol = 0.01 * ids.length + 0.01;
  const how = U.add ? `by ${U.add}` : `by ${U.pct}%`;
  const setTo = U.add ? `${qi(U.field)} + ${U.add}` : `${qi(U.field)} * ${1 + U.pct / 100}`;
  add('query.update', 'Action queries', 3, `Create and run an update query called qryRaise that increases ${U.field} ${how} for every record in ${U.table} where ${U.whereField} is ${uv}. Run it once only.`,
    { kind: 'sql', sql: `SELECT abs((SELECT sum(${qi(U.field)}) FROM ${qi(U.table)} WHERE ${inIds}) - ${want}) <= ${tol} AND abs((SELECT coalesce(sum(${qi(U.field)}), 0) FROM ${qi(U.table)} WHERE NOT (${inIds})) - ${others}) <= 0.01`, label: `${U.field} raised ${how} where ${U.whereField} is ${uv}, and only there` },
    (x) => { const sql = `UPDATE ${qi(U.table)} SET ${qi(U.field)} = ${setTo} WHERE ${qi(U.whereField)} = ${lit(uv)}`; x.saveQuery({ name: 'qryRaise', kind: 'update', sql }); x.db.run(sql); });

  // ---- forms and reports
  const F = P.form;
  add('form', 'Forms and reports', 2, `Create a form called frm${F.source} based on ${F.source} that shows ${F.fields.join(', ')}.`, { kind: 'form', source: F.source, fields: F.fields }, (x) => x.saveForm(autoForm(x, F.source, `frm${F.source}`, F.fields)));
  const R = P.report;
  add('report', 'Forms and reports', 3, `Create a report based on ${R.source} that is grouped by ${R.group}, shows ${R.show.join(', ')}, and has a total of ${R.total} for each group.`, { kind: 'report', source: R.source, groupField: R.group, total: true },
    (x) => x.saveReport(autoReport(x, R.source, `rpt${R.source}By${R.group}`, { groupBy: R.group, fields: R.show, totals: [R.total] })));
  return out;
}

// ---------------------------------------------------------------- ready tests
export const LEVELS = [
  { id: 'core', name: 'Core', minutes: 40, about: 'Tables, a relationship, validation, simple queries and a form.', keys: ['table.pk', 'table.type', 'table.rel', 'table.records', 'validation', 'query.text', 'query.number', 'form'] },
  { id: 'extended', name: 'Extended', minutes: 60, about: 'Wildcards, dates, parameters, joins, totals, a calculated field, an update query and a grouped report.', keys: ['query.like', 'query.date', 'query.parameter', 'query.join1', 'query.totals1', 'query.calc', 'query.update', 'report'] },
  { id: 'full', name: 'Full paper', minutes: 90, about: 'Every task type for this database.', keys: ['table.pk', 'table.type', 'table.rel', 'table.records', 'validation', 'query.text', 'query.number', 'query.like', 'query.date', 'query.parameter', 'query.join1', 'query.join2', 'query.totals1', 'query.totals2', 'query.calc', 'query.update', 'form', 'report'] },
] as const;
export type LevelId = (typeof LEVELS)[number]['id'];

/** The sample database without its saved queries, forms and reports: what students start from. */
export async function startDatabase(sample: SampleId): Promise<WowProject> {
  const p = await buildSample(sample);
  for (const type of ['query', 'form', 'report'] as const) for (const o of p.listObjects(type)) p.deleteObject(type, o.name);
  return p;
}

export interface ReadyTest { title: string; instructions: string; durationMin: number; tasks: LibTask[]; start: WowProject; }
export async function readyTest(sample: SampleId, level: LevelId, seed = Math.floor(Math.random() * 1e9)): Promise<ReadyTest> {
  const info = SAMPLE_LIST.find((s) => s.id === sample)!; const L = LEVELS.find((l) => l.id === level)!;
  const start = await startDatabase(sample);
  const lib = taskLibrary(sample, start, seed);
  const tasks = L.keys.map((k) => lib.find((t) => t.key === k)!).filter(Boolean);
  return {
    title: `${info.name}: ${L.name} practical`,
    instructions: `You will work in the ${info.name} database (fictional data). Complete every task. Use the exact table, field and query names given. Save your work as you go; it is saved automatically every few seconds while you work.`,
    durationMin: L.minutes, tasks, start,
  };
}

/** Run every model answer (in task order) on a database. */
export function solveAll(p: WowProject, tasks: LibTask[]) { for (const t of tasks) t.solve(p); }
